# Vectra Finance — Operations Runbook

## Environments

| Env | Chain | Config | Notes |
|---|---|---|---|
| local | anvil 31337 | `scripts/dev-chain.sh` → `deployments/31337.json` | **Mock assets only** (`mock: true`) |
| staging | a public testnet or a fork | `deployments/<chainId>.json`, separate keys and DB | Real protocol addresses where available |
| production | mainnet / L2 | `deployments/<chainId>.json`, multisig admin, timelock | Separate keeper key, alert webhook required |

Never reuse keys, databases or `.env` files across environments. `.env*` files are git-ignored; only
`.env.example` templates are committed.

## Deploy

1. `forge build --sizes` (must pass EIP-170) and `forge test`.
2. Core: `VECTRA_ADMIN=<timelock> forge script script/DeployCore.s.sol --rpc-url $RPC_URL --account <ks> --sender <deployer> --broadcast --verify`.
   Writes `deployments/<chainId>.json`. The deployer temporarily administers the registry, approves
   the four adapter implementations, then hands admin to `VECTRA_ADMIN` and renounces.
3. Governance approves vetted underlying vaults: `AdapterRegistry.setTargetApproved(target, true)`.
4. Governance grants `IndexFactory.CREATOR_ROLE` to the curator team.
5. Create an index from a reviewed config: `INDEX_CONFIG=script/config/<name>.json forge script script/CreateIndex.s.sol ...`.
6. **Seed** each new index with a small deposit from the treasury before announcing it (defence in depth
   against share-price manipulation of an empty index).
7. Start backend processes (`migrate`, then `indexer`, `api`, `keeper`) with the new deployment file;
   grant `KEEPER_ROLE` on each index to the keeper address.
8. Point the web app at the chain/RPC/factory/lens/API via env and deploy.

### Gas limits on Sepolia (and future forks)

Sepolia currently charges far more gas for contract creation than Foundry's local EVM models: the node
estimates 4.08M gas to create `AdapterRegistry` (Foundry: 0.60M) and **38.3M for the `IndexVault`
implementation** (Foundry: 5.3M). Forge sets limits from its local simulation (×1.3 by default), so the
first deployment attempt ran out of gas on its very first transaction. Use
`--gas-estimate-multiplier 800` (you pay only for gas used) and an explicit low `--with-gas-price`.
If a per-transaction gas cap (EIP-7825, 2^24 = 16.78M) is ever enforced together with this pricing,
the 24 KB vault implementation could not be deployed in one transaction and would have to be split; the
cap was not enforced on Sepolia at deployment time (a 16,777,217-limit transaction was accepted).

### Rollback

Contracts are immutable. "Rollback" means: pause deposits on the affected index (`PAUSER`), stop
creating indexes (`IndexFactory.setCreationPaused`), revoke affected targets/implementations in the
registry (existing positions keep working and can be withdrawn), and if needed deploy a fixed
implementation + new factory and migrate users. Backend and web are stateless deploys: roll back by
redeploying the previous image; the DB can always be rebuilt (`rebuild`) from chain events.

## Routine keeper operations

- `processRedemptions(n)` whenever open requests exist and the vault holds base asset.
- `rebalance(maxActions)` when the base balance is below `reserved + buffer` (restores liquidity) or
  above it by more than the tolerance (invests).
- `pullFromAdapter` / `pushToAdapter` for drift beyond threshold (policy-flagged; on-chain caps apply).
- `expireRedemption(id)` for expired requests (returns shares to the owner).

If the keeper is down, **anyone** can call `processRedemptions` and `expireRedemption`; only rebalancing
waits. Restore the keeper or call `rebalance` manually from a `KEEPER_ROLE` signer.

## Incidents

| Signal | Likely cause | Action |
|---|---|---|
| `AdapterUnhealthy` events / lens `healthy=false` | Underlying paused, bad debt (`lostAssets>0`), valuation failing | Curator removes it from weights (`setAdapterWeights` without it); keeper pulls liquidity when withdrawable |
| Lens `navHealthy=false`, deposits/redeems revert | An adapter's `totalAssets()` reverts | Admin `setAdapterQuarantined(adapter, true)` (pauses deposits automatically); investigate; un-quarantine on recovery |
| Queue age above threshold | Underlying illiquid, keeper down, or floors unmet | Check `maxWithdraw` per adapter; run `rebalance`; inform users via status page; consider raising buffer |
| `RedemptionPaymentBlocked` | Receiver/owner no longer eligible | Contact holder; they can cancel to an eligible address |
| Eligibility provider failing | Provider outage (module fails closed) | Attestor sets local eligibility for affected users if appropriate, or switch provider (admin) |
| Suspected exploit | — | Guardian: `setDepositsPaused(true)` and `setRedemptionsPaused(true)` on affected indexes; `emergencyShutdown` if allocation logic itself is suspect; pause factory creation; revoke registry approvals |
| Indexer lag / reorg alerts | RPC issues or deep reorg | Check RPC; the indexer rewinds automatically within its window; for deeper issues run `rebuild` |
| Keeper dead letters | Repeated tx failures (gas cap, revert in simulation) | Inspect `/v1/keeper/status`; fix cause; retry manually |

## Monitoring checklist

- Per index: NAV and price-per-share change, available liquidity vs buffer target, queue depth and
  oldest request age, adapter health and drift, paused/shutdown flags.
- Backend: `/health` (DB, RPC, indexer lag), `/metrics`, keeper dead letters, alert webhook delivery.
- Governance: role changes (`RoleGranted`/`RoleRevoked`), registry approvals, compliance module changes.
