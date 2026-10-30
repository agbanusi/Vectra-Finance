# Vectra Finance — Architecture

Vectra issues **index tokens**: ERC-20 shares in an index vault that holds a liquidity buffer of a single
settlement asset plus positions in curated ERC-4626 vaults (Morpho, Euler, RWA and generic 4626). One
token gives diversified exposure; redemptions are instant from the buffer or fair-queued when the
underlying positions need to be unwound.

```
                     ┌──────────────────────── on-chain ────────────────────────┐
  user ── deposit ──▶│ IndexVault (clone, = ERC-20 index token)                 │
       ◀─ redeem ───│   NAV = base balance + Σ adapter.totalAssets()            │
                     │   buffer · FIFO queue · fees · compliance hook          │
                     │        │ approve+deposit / withdraw (vault-only)         │
                     │        ▼                                                 │
                     │  Adapter clones (1 per index × position)                 │
                     │   ERC4626 · MORPHO · EULER · RWA ──▶ underlying vaults   │
                     │                                                          │
                     │  IndexFactory ─ clones ─▶ IndexVault implementation      │
                     │  AdapterRegistry: approved implementations + targets     │
                     │  ComplianceModule (optional, per index)                  │
                     │  IndexLens: read-only aggregation (never reverts)        │
                     └──────────────────────────────────────────────────────────┘
                              ▲ events / lens reads           ▲ keeper txs
  apps/web (Next.js) ──▶ services/backend: indexer → SQLite → REST API · keeper bot
```

## Contracts

| Contract | Responsibility | Privileges |
|---|---|---|
| `IndexVault` | Index token (ERC-20), deposits, NAV, buffer, redemption queue, fees, config, emergency controls | Roles below; no upgrade path |
| `IndexFactory` | Clones the vault implementation and registers indexes | `CREATOR_ROLE` creates; `PAUSER_ROLE` pauses creation; no power over existing indexes |
| `AdapterRegistry` | Allowlists adapter implementations **and** underlying targets; clones adapters bound to the calling vault | Registry admin approves/revokes for *new* adapters only |
| `BaseERC4626Adapter` + `ERC4626` / `MORPHO` / `EULER` / `RWA` | Normalised deposit/withdraw/valuation for one vault position | Only the bound index vault can move funds |
| `AllowlistCompliance` / `PermissionlessCompliance` | Eligibility for deposits, redemptions and share transfers | Attestor role sets eligibility bits; admin sets external provider |
| `FeeManager` (inherited) | Management + performance fees paid by minting shares | Curator sets fees within hard caps (20%/yr, 30% of gains) |
| `IndexLens` | One-call views for UI, API and keepers; fee-aware previews | None |

The original design (a separate `IndexToken` deployed by each vault, and a factory using `new`) produced
a 30.4 KB vault and a 34.0 KB factory — both over the EIP-170 24,576-byte limit and undeployable. The
vault is now its own share token, vaults are EIP-1167 clones, views moved to `IndexLens`, and the IR
pipeline is enabled (optimizer runs 100). Current sizes: vault 24.26 KB (~320 bytes headroom), factory 3.4 KB, lens ~9 KB. Further vault features must be paid for by moving logic to periphery. CI fails if any contract
exceeds the limit.

### Roles (per index)

| Role | Holder (expected) | Can | Cannot |
|---|---|---|---|
| `DEFAULT_ADMIN` | Timelocked multisig | Rotate curator, grant roles, **set compliance module**, **quarantine an adapter** | Move user funds |
| `CURATOR` | Index curator multisig | Deploy adapters on approved targets, set weights, liquidity params, limits, fees (capped) | Use unapproved targets; change compliance; move funds anywhere but approved adapters |
| `KEEPER` | Bot hot key | `rebalance`, `pullFromAdapter`, `pushToAdapter` (bounded on-chain) | Pay anyone, change config |
| `PAUSER` | Guardian | Pause deposits/redemption requests, irreversible `emergencyShutdown` | Block queue processing, cancellation or expiry |
| anyone | — | `processRedemptions`, `expireRedemption`, `accrueFees` | Redirect payouts |

## Accounting model

- **Single settlement asset per index** (e.g. USDC). Every adapter must report and settle in that asset;
  the vault checks `adapter.asset() == baseAsset`. Cross-asset positions would need a price oracle and
  are intentionally out of scope for v1.
- `NAV = baseAsset.balanceOf(vault) + Σ adapter.totalAssets()` over non-quarantined adapters. Adapters
  value positions via the underlying vault's `previewRedeem(sharesHeld)`, i.e. net of exit fees and at
  the protocol's own exchange rate — never a cached or summed balance.
- **Shares** (18 decimals): `shares = assets × (supply + virtualShares) / (NAV + 1)` with
  `virtualShares = 10^(18 − baseDecimals)`. The offset makes first-depositor donation attacks
  unprofitable (OpenZeppelin ERC-4626 design). Known, bounded side effect: a depositor can capture at
  most `virtualShares` worth of value per deposit at the current price — a fuzz test asserts this bound.
- **Redemption value**: `assets = floor(shares × NAV / supply)`. Rounding always favours the vault.
- **Fees** are minted as shares to the fee recipient (never base-asset transfers), so they cannot touch
  the buffer or queue reservations. Fees accrue before every deposit, redemption, queue run and fee
  change, so rates never apply retroactively. The performance fee uses a per-share high-water mark.
- Fee-on-transfer or rebasing base assets are rejected (`NonStandardTransfer`).

### Why a single settlement asset (trade-offs)

| Option | Pros | Cons | Decision |
|---|---|---|---|
| Single settlement asset (chosen) | Exact NAV without oracles; simple deposit/redeem UX; adapters isolate protocol quirks | Index can only hold positions denominated in that asset | **v1** |
| Deposit/redeem the underlying basket in kind | No liquidity buffer needed; no conversion | Many approvals per user, each underlying's restrictions hit the user, unusable for async/RWA positions | Not chosen |
| Multi-asset deposits with swaps | Flexible UX | Requires DEX routing, oracle-checked slippage and MEV protection | Future `DepositRouter` periphery; the vault interface does not need to change |

## Redemption lifecycle

```
            redeem() with enough free liquidity ──────────────▶ paid instantly (Redeemed)
            redeem(allowQueue=true) otherwise
                          │  shares escrowed in the vault
                          ▼
                     ┌─────────┐ processRedemptions (balance < claim, partial fills on)
                     │ PENDING │──────────────────────────────┐
                     └─────────┘                              ▼
           cancel ◀──┤    │  processRedemptions        ┌──────────────────┐
     (owner, to an   │    │  (balance ≥ claim)         │ PARTIALLY_FILLED │──┐
     eligible        │    ▼                            └──────────────────┘  │
     recipient)      │ ┌───────────┐ ◀────────────────────────────────────────┘
                     │ │ FULFILLED │
                     │ └───────────┘
   ┌───────────┐     │      expireRedemption (anyone, after TTL) ──▶ ┌─────────┐
   │ CANCELLED │ ◀───┘                                               │ EXPIRED │
   └───────────┘                                                     └─────────┘
   (CANCELLED/EXPIRED return the remaining escrowed shares; amounts already paid stay paid)
```

Rules enforced on-chain:

1. **Instant only from free liquidity**: `free = baseBalance − reservedAssets`, where
   `reservedAssets = reservedShares × NAV / supply` (rounded up). Adapters are never force-liquidated
   inside a user call, so a run cannot trigger fire-sales or let instant redeemers jump the queue.
2. **Fill-time pricing**: queued requests are paid at NAV when filled, with the requester's
   `minAssetsOut` as a floor. Queued holders bear the same gains/losses as everyone else — no stale
   price can make the index insolvent. After a partial fill the floor is scaled to the remaining shares.
3. **FIFO with skip semantics**: payable requests are paid in id order. When the balance cannot cover
   the next payable request it is partially filled (if enabled) and processing stops. Requests that are
   not payable *now* (floor above claim, compliance-blocked, expired) are skipped so one request cannot
   freeze the queue. `maxRequests` bounds requests visited, keeping gas bounded.
4. **Reservations are untouchable**: deposits allocate only their own investable portion; `rebalance`
   and `pushToAdapter` can only invest balance above `reserved + buffer`.
5. **No double claims**: escrowed shares are burned as they are paid; request state is closed exactly
   once; the invariant suite checks escrow == reserved shares == Σ open request shares and per-request
   payments == recorded `assetsPaid`.
6. Underlying withdrawal limits, pauses and failures are respected: keepers withdraw at most
   `maxWithdraw`, failures are caught and skipped, the queue simply waits.

### Limits of on-chain liquidity

Instant liquidity is only as large as the buffer. Queue fulfilment depends on underlying vaults having
withdrawable liquidity (MetaMorpho idle + market liquidity, Euler cash, RWA issuer redemption windows)
and on someone calling `rebalance`/`pullFromAdapter`. The contracts never promise a settlement time; the
UI shows queue depth and explains what unblocks fulfilment. Asynchronous (ERC-7540 request/claim)
vaults are **not** supported by the synchronous adapters and must not be onboarded until a dedicated
adapter exists.

## Compliance

- `complianceModule == 0` → permissionless index. Otherwise the module validates deposits (payer and
  receiver), redemptions (owner and receiver), and every share transfer between holders (enforced in
  the token's `_update`, so secondary transfers cannot bypass it).
- `AllowlistCompliance` stores only an eligibility bit and optional expiry per address, plus an
  optional external `IEligibilityProvider(account, policyId) → bool` (fail-closed on revert). No
  personal data is stored on-chain; KYC happens off-chain at the provider.
- Revoked holders can still move shares (or cancelled escrow) **to an eligible address**, so revocation
  never traps value; they cannot receive, deposit or redeem.
- Underlying RWA tokens enforce their own transfer restrictions on the adapter address; the index
  cannot bypass them. Restricted RWA indexes must also configure an index-level module whose policy is
  at least as strict as the issuer's.

## Adapters and integration status

| Kind | Behaviour | Health signal | Verified |
|---|---|---|---|
| `ERC4626` | Sync deposit/withdraw, valued by `previewRedeem` | `previewRedeem` doesn't revert | Unit tests on a faithful mock; fork test harness (opt-in) |
| `MORPHO` | MetaMorpho vaults (v1.0 and v1.1) | v1.1 `lostAssets() > 0` ⇒ unhealthy; v1.0 (no function) falls back to base check | Logic unit-tested on mocks. **Confirm the version of each vault before onboarding.** |
| `EULER` | Euler v2 EVault, supply side only | Base check; hooks/caps surface through `maxDeposit`/`maxWithdraw` | Mock-tested. The original `unitOfAccount == asset` check was removed: it is irrelevant to depositors and would have rejected typical EVaults. **Verify `max*` behaviour per vault on a fork.** |
| `RWA` | Only RWA vaults with a synchronous ERC-4626 surface | Base check | Issuer allowlisting of the adapter address and redemption windows must be confirmed per issuer |

Every underlying target must be approved in `AdapterRegistry.setTargetApproved` by governance after
review (asset, ERC-4626 conformance, liquidity profile, curator/timelock settings, permissions). No
production addresses are shipped in this repo; `script/config/example-index.json` is a template.

## Off-chain services

- **Indexer** ingests factory and vault events with confirmation depth, block-hash reorg detection and
  idempotent writes; derived tables are rebuildable from the raw event log.
- **API** serves discovery, history (only real snapshots), portfolio and keeper status; chain reads via
  the lens remain authoritative.
- **Keeper** processes the queue, restores the buffer, optionally corrects drift, expires stale
  requests and raises alerts. It holds only `KEEPER_ROLE`; the system stays safe if it stops or
  misbehaves (anyone can call `processRedemptions`/`expireRedemption`; keeper actions are bounded).

See `services/backend/README.md` and `apps/web/README.md` for details.

## Upgradeability

None. Vaults and adapters are immutable clones; the factory can only stop creating new indexes. A
change of economics means a new index and a user-initiated migration. This removes proxy-admin risk
over user funds at the cost of slower iteration.

## Client guidance: gas limits

Fee accrual runs at the start of every state-changing call and mints fee shares only when time has
passed since the last accrual. A gas estimate taken in the same block as the previous interaction
therefore omits those writes, while the transaction itself (mined a block later) includes them. This was
observed on the local demo: a queued `redeem` estimated at 328,619 gas needed ~330,000 and reverted out
of gas. The web app (`apps/web/src/lib/gas.ts`) and the keeper (`services/backend/src/keeper/backend.ts`)
both submit with an explicit limit of estimate × 1.25. Third-party integrators should do the same.
