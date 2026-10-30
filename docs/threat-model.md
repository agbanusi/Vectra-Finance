# Vectra Finance — Threat Model

Scope: contracts in `src/`, the keeper/indexer/API in `services/backend`, the web app in `apps/web`.
Status: **not audited.** Do not hold real user funds until the reviews at the end are complete.

## Assets at risk

1. Base assets held by each index vault (buffer) and by its adapters (underlying vault shares).
2. Escrowed index shares of queued redemption requests.
3. Correctness of NAV, share issuance and redemption payouts.
4. Eligibility status for restricted indexes (integrity, and privacy of who is eligible).
5. Keeper hot key, API admin token, RPC credentials.

## Trust assumptions

| Actor | Trusted for | Not trusted for |
|---|---|---|
| Registry admin (governance multisig + timelock) | Approving adapter implementations and underlying targets | Anything per-index |
| Index admin (timelocked multisig) | Role management, compliance module choice, quarantining a broken adapter | Moving funds (no such path exists) |
| Curator | Choosing weights among approved targets, fees within caps, liquidity params | Choosing arbitrary targets, changing compliance, moving funds |
| Keeper | Liveness only | Correctness — all keeper actions are bounded on-chain; anyone can process the queue |
| Pauser / guardian | Fast pausing and irreversible shutdown | Blocking exits (queue processing, cancel and expire stay open) |
| Underlying vaults | Honest `previewRedeem`/`maxWithdraw`, solvency | — this is the main economic risk of any index |
| Compliance attestor / provider | Correct eligibility bits | Custody; a malicious attestor can deny service to restricted users |
| Backend / web | Convenience | Authority — the chain is the source of truth |

## Threats and mitigations

| # | Threat | Mitigation | Test |
|---|---|---|---|
| T1 | First-depositor share-price inflation | Virtual-share offset; ops seed each index at launch | `test_FirstDepositorDonationAttackIsUnprofitable` |
| T2 | Rounding extraction on deposit/redeem | Floor in vault's favour; bound proven by fuzzing | `testFuzz_DepositRedeemRoundTrip*` |
| T3 | Minting without consideration | Shares minted only after exact balance-delta check; fee-on-transfer rejected | `test_RevertOnFeeOnTransferBase`, invariants |
| T4 | Bank run / queue skipping | Instant only from free liquidity; reservations at current NAV; queue paid from balance first | `test_InstantRedeemCannotJumpQueue`, `test_NewDepositCannotConsumeReservedAssets` |
| T5 | Stale-price insolvency on queued claims | Fill-time NAV pricing with per-share floor | `test_RedemptionPaysAtFillTimeNav`, `test_FloorScalesWithPartialFills` |
| T6 | Queue freeze via a request with a tight floor | Unmet floors are skipped, not blocking | `test_UnmetFloorIsSkippedNotBlocking` |
| T7 | Queue gas-griefing | `maxRequests` bounds visits; `minRedeem` and `maxQueueLength` raise the cost; expiry clears stale entries | `test_ProcessingVisitsAreBounded` |
| T8 | Double claim / replay | Escrowed shares burned on payment; single-shot status transitions | `test_DoubleSpendPrevention`, invariant `NoDoublePayment` |
| T9 | Malicious or compromised adapter | Registry-approved implementations only; adapter bound to one vault; vault credits balance deltas, not return values; approvals reset to zero; `nonReentrant` on all entry points | `test_VaultTrustsBalanceDeltaNotAdapterReturn`, `test_AdapterReentrancyBlocked` |
| T10 | Curator routes funds to an attacker vault | Governance target allowlist in `AdapterRegistry` | `test_UnapprovedTargetRejected` |
| T11 | Curator freezes exits via compliance module | `setCompliance` is admin-only | `test_CuratorCannotSwapComplianceModule` |
| T12 | One adapter's valuation reverts → whole index frozen | Admin `setAdapterQuarantined` excludes it from NAV and force-pauses deposits; lens never reverts | `test_RevertingValuationCanBeQuarantined` |
| T13 | Underlying loss / bad debt | NAV marks to `previewRedeem`; MetaMorpho v1.1 `lostAssets` stops new allocations; per-adapter slippage guard on deposit | `test_UnderlyingLossReducesNav`, `test_MorphoBadDebt*` |
| T14 | Underlying illiquid / paused / capped | Respect `maxDeposit`/`maxWithdraw`; failures skipped; queue waits | `test_WithdrawalsDisabledQueueWaits`, `test_DepositCap*`, `test_PausedUnderlying*` |
| T15 | Compliance bypass via secondary transfer | Checked in token `_update`; escrow moves use the unhooked path but returns re-validate the recipient | Compliance suite |
| T16 | Revocation trapping value | Revoked holders can send to eligible addresses and cancel escrow to an eligible recipient | `test_RevokedHolderCanExitToEligible`, `test_CancelRedemptionToEligibleSucceeds` |
| T17 | Eligibility provider outage | Fail closed for that provider; local attestations still work | `test_BrokenProviderFailsClosed` |
| T18 | Pause abuse trapping funds | Pause cannot stop processing/cancel/expire; shutdown keeps exits open | `test_EmergencyShutdownIsIrreversibleAndExitsStayOpen` |
| T19 | Fee abuse | Hard caps; accrue-before-change; HWM | Fees suite |
| T20 | Underlying share-price manipulation (donation) | Unprofitable unless the index dominates the vault; governance must only approve vaults whose share price cannot be cheaply moved | Review item |
| T21 | Keeper key compromise | Keeper can only move funds between the vault and its approved adapters within caps; rotate role via admin | By construction |
| T22 | Off-chain DB corruption / reorg | Idempotent ingestion, block-hash reorg detection, full rebuild from raw events | Backend tests |
| T23 | Frontend misleading users | UI never fabricates data; instant vs queued derived from on-chain previews | Web tests |

## Residual risks and known limitations

- Underlying vault risk (bad debt, curator misconfiguration, oracle failure in lending markets) passes
  through to index holders by design.
- Quarantine writes a position down to zero for NAV while active; instant redeemers during that window
  receive the conservative value and remaining holders benefit if it recovers. This is an admin
  judgement call and must go through the timelock except in emergencies.
- `maxQueueLength` can be filled by a well-capitalised griefer; their capital is locked while queued and
  is paid out FIFO, but honest users cannot queue until entries clear. Set `minRedeem` meaningfully.
- Rounding leak bounded by `virtualShares` × price per share per deposit (dust in practice).
- No oracle: cross-asset positions, async (ERC-7540) vaults and DEX-routed deposits are unsupported.
- Governance keys are a central trust point; use multisig + timelock and publish addresses.

## Required before handling real funds

1. Independent smart-contract audit of `src/` (focus: queue accounting, fee maths, compliance hook,
   quarantine path, adapter integration).
2. Fork tests against every target vault you intend to approve (`test/fork/ERC4626Fork.t.sol`), on each
   chain, at current block, including withdrawal-limit scenarios.
3. Per-target due diligence: MetaMorpho version and timelock, Euler hook configuration, RWA issuer
   allowlisting of adapter addresses and redemption mechanics.
4. Governance setup: multisig thresholds, timelock delay on admin/registry roles, guardian runbook.
5. Backend security review (auth on admin endpoints, rate limits behind a real proxy, secrets handling)
   and a key-management plan for the keeper (HSM/KMS or a dedicated signer service).
6. Economic review of fee parameters and buffer sizing per index.
