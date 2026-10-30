# @vectra/backend

Indexer, read API and keeper bots for Vectra Finance. TypeScript (ESM, strict), viem, Hono, and
`node:sqlite`, which is built into Node 22, so there are no native modules.

**The chain is authoritative.** The database is a cache that can be rebuilt. Live values such as NAV,
balances, request state and user positions are read through `IndexLens`, which never reverts when an
adapter is broken. The DB holds event history, derived history, NAV snapshots, curated metadata and
keeper bookkeeping.

## Process layout

| Process | Command | Role | Writes |
|---|---|---|---|
| indexer | `pnpm --filter @vectra/backend start:indexer` | Ingests factory and vault events, handles reorgs, takes NAV snapshots | events, derived tables, snapshots |
| api | `start:api` | Read API, metrics, admin metadata | `index_metadata` only |
| keeper | `start:keeper` | Redemption processing, liquidity, expiry, alerts | job_runs, job_leases, dead_letters |
| one-off | `migrate`, `rebuild [--from-chain]` | Schema migrations and re-derivation | |

All three share one SQLite file in WAL mode with `busy_timeout`, so run them on one host or volume.
Every process runs migrations on start, and migrations are idempotent. Keeper replicas coordinate
through DB leases, which only works while they share that DB file. To run on several hosts, move to
Postgres; the repo layer in `src/db/` is the only thing to swap.

```
src/
  config.ts          env parsing and validation (fails fast, never logs secrets)
  runtime.ts         bootstrap, run loop, graceful shutdown
  chain/             ChainSource (indexer), ProtocolReader (lens reads), viem clients
  db/                migrations, repositories
  indexer/           decode, derive (pure projection), indexer (reorgs), snapshots
  api/               Hono app, validation, auth, rate limiting, metrics
  keeper/            state, decisions (pure), alerts (pure + notifier), executor, backend (viem), loop
  cli/               entrypoints
```

## Running locally against the demo

```bash
pnpm install
pnpm dev:chain                                # anvil :8545 + LocalDemo -> deployments/31337.json
cp services/backend/.env.example services/backend/.env   # then set values
cd services/backend
set -a; . ./.env; set +a
pnpm start:indexer &   pnpm start:api &   KEEPER_PRIVATE_KEY=<anvil account #1 key> pnpm start:keeper
curl localhost:8787/v1/indexes
```

LocalDemo grants KEEPER to anvil account #1. Its key is a public anvil dev key; use it only on anvil.

## Environment variables

See `.env.example` for the full list and defaults. Required: `RPC_URL`, `CHAIN_ID`, `DEPLOYMENT_FILE`.
Startup checks that the deployment's `chainId` matches `CHAIN_ID`.

- **Secrets:** `KEEPER_PRIVATE_KEY` (optional; without it the keeper runs in dry-run mode) and
  `ADMIN_API_TOKEN` (optional, at least 24 characters; without it admin routes return 503). The
  logger redacts any field whose key looks like a key, token, secret, password or authorization.
- **Indexer:** `CONFIRMATIONS`, `INDEXER_POLL_MS`, `INDEXER_BATCH_BLOCKS`, `REORG_WINDOW_BLOCKS`, `SNAPSHOT_INTERVAL_MS`.
- **API:** `API_HOST`, `API_PORT`, `CORS_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_BURST`, `TRUST_PROXY`, `HEALTH_MAX_LAG_BLOCKS`.
- **Keeper:** `KEEPER_POLL_MS`, `KEEPER_MAX_FEE_PER_GAS_WEI`, `RETRY_*`, `LEASE_TTL_MS`, `ALERT_WEBHOOK_URL`,
  `ALERT_COOLDOWN_MS`, and the policy flags described below.

## Indexer: reorgs and rebuilds

- The indexer discovers indexes from `IndexCreated` events, starting at `startBlock`. Each batch reads
  the factory logs first, then the logs of every known vault plus any vault created in that batch, so
  events emitted in the same range as a creation are not missed.
- It ingests in ranges of at most `INDEXER_BATCH_BLOCKS`, up to `head - CONFIRMATIONS`. Logs whose
  topics don't match the ABIs are stored raw as `Unknown`; nothing is dropped.
- **Consistency:** headers are fetched for the first block, the last block and every block that has a
  log. Each log's `blockHash` must match its header, otherwise the batch is discarded and retried. The
  events, derived rows, block hashes and cursor for a batch commit in one transaction.
- **Reorg detection:**
  - Before each batch, the first new block's `parentHash` must equal the stored cursor hash.
  - When there is no new block, the cursor block's own hash is re-checked.
- **Reorg handling:**
  - The indexer walks stored hashes newest-first and compares each with the chain to find the common
    ancestor.
  - In one transaction it deletes events, block hashes and snapshots above the ancestor, rebuilds the
    derived tables from the remaining events, and moves the cursor back.
  - If no stored hash matches within `REORG_WINDOW_BLOCKS`, it raises `DeepReorgError` and does not
    guess. The fix is `pnpm rebuild --from-chain`.
- **Idempotency:** events are unique on `(chain_id, block_hash, log_index)` and inserted with
  `INSERT OR IGNORE`. Derived updates only run for newly inserted rows, so a crash and replay is safe.
- **Derived state** (`indexes`, `redemption_requests`, `user_activity`) is a pure projection of
  `events` in chain order. `pnpm rebuild` recreates it exactly; tests check this equivalence.
  `index_metadata` is curated off-chain and is never touched by a rebuild.
- **NAV snapshots** are lens reads taken *at the cursor block*. History only returns real snapshots,
  never interpolated values.

## API

Every response is `{ "data": ... }` with bigints as decimal strings. Errors use the shape
`{ "error": { "code", "message", "details?" } }`.

| Method & path | Notes |
|---|---|
| `GET /health` | db, rpc (3s timeout), `head`, `indexedBlock`, `lagBlocks`. Returns 503 when degraded |
| `GET /metrics` | Prometheus text: request counter, indexed block, open dead letters |
| `GET /v1/indexes` | Live `IndexLens.getIndexes` for every known index, plus `adapters[].kindName`, `createdBlock`, `metadata` |
| `GET /v1/indexes/:address` | Same for one index (404 if unknown) |
| `GET /v1/indexes/:address/history?from&to&limit` | NAV snapshots; `from`/`to` are unix seconds |
| `GET /v1/indexes/:address/requests?status=all\|open\|pending\|partially_filled\|fulfilled\|cancelled\|expired` | Derived requests |
| `GET /v1/indexes/:address/activity?limit&offset` | Derived activity for the index |
| `GET /v1/portfolio/:wallet` | `positions` from `lens.getUser` (shares > 0) and `openRequests` from the DB, each re-read on-chain; stale rows are dropped |
| `GET /v1/activity/:wallet?limit&offset` | Kinds: deposit, redeem, redemption_requested, redemption_partially_filled, redemption_filled, redemption_cancelled, redemption_expired, transfer_in, transfer_out |
| `GET /v1/keeper/status` | Last 50 job runs and open dead letters |
| `PUT /v1/admin/indexes/:address/metadata` | Bearer `ADMIN_API_TOKEN`, compared in constant time. Body `{description?, category?, riskTier?: low\|medium\|high, tags?: string[]}`; unknown fields are rejected |

Requests are logged as structured JSON. CORS allows `CORS_ORIGINS`. Each IP gets an in-memory token
bucket on `/v1/*` and receives a 429 with `Retry-After` when it runs out. The limiter is per process,
so add an edge limiter when running several replicas.

## Keeper policies and safety reasoning

The bot holds only `KEEPER_ROLE`. It cannot move user funds anywhere except as the contracts allow:
the vault only pays recorded receivers, and adapters only return funds to the vault. Every decision is
a pure function in `keeper/decisions.ts`. Every call is then **simulated** before it is sent, and the
contracts enforce the rules again on-chain. A bad decision therefore costs at most a skipped or no-op
transaction. The bot never tries to work around a revert.

Each tick re-reads chain state through the lens for each index and takes up to
`KEEPER_MAX_ACTIONS_PER_INDEX_TICK` actions. State is re-read after every action. Priority order:

1. **Expire** (`KEEPER_ENABLE_EXPIRE`): `expireRedemption(id)` for open requests past `expiresAt`,
   judged by chain time. This is permissionless and returns the shares to the owner.
2. **Rebalance** (`KEEPER_ENABLE_REBALANCE`): the keeper mirrors the vault's target balance
   (reserved + buffer% of the rest). It calls `rebalance(REBALANCE_MAX_ACTIONS)` in three cases:
   - *queue shortfall*: eligible requests exist and reserved assets exceed the balance;
   - *buffer shortfall*: the balance is below target by more than `REBALANCE_THRESHOLD_BPS` of NAV;
   - *excess*: the balance is above target plus tolerance. This mirrors the on-chain condition and is
     skipped during shutdown or when `navHealthy=false`.

   It is skipped when no adapter can be withdrawn from.
3. **Process** (`KEEPER_ENABLE_PROCESS`): calls `processRedemptions(n)` when the base balance is
   above 0 and the first eligible request (not expired, claim at or above its floor) can be paid at
   least in part. `n` counts requests *visited*, so it covers floor-blocked or expired entries ahead in
   the queue, capped at `PROCESS_MAX_REQUESTS`.
4. **Drift** (`KEEPER_ENABLE_DRIFT`, off by default): corrects the single most-drifted adapter beyond
   `DRIFT_THRESHOLD_BPS`.
   - `pullFromAdapter` moves the overweight amount, up to `maxWithdraw`.
   - `pushToAdapter` moves at most the smallest of: the underweight amount, free liquidity above
     target, the on-chain cap (target+tolerance of invested NAV), and `maxDeposit`. It only runs for
     healthy, enabled, non-quarantined adapters and never during shutdown.
   - Drift is skipped in any tick that attempted a rebalance, so the two strategies cannot fight.

**Execution path:**

- **Lease:** a per-(index, group) DB lease, where the groups are `queue` and `liquidity`, so
  conflicting actions never overlap across instances. Leases expire after `LEASE_TTL_MS`.
- **Simulation:**
  - A simulated revert is recorded as `simulation_reverted` and nothing is sent.
  - A simulated no-op is recorded as `noop` and nothing is sent: `processRedemptions` returning 0,
    `rebalance` returning (0,0), or a pull or push returning 0.
- **Dry run:** without a key, the would-send result is recorded as `dry_run`. Simulations then run
  without a sender, so KEEPER-only calls show up as `simulation_reverted`.
- **Gas:** if the estimated `maxFeePerGas` is above `KEEPER_MAX_FEE_PER_GAS_WEI`, the action is
  recorded as `deferred_gas`.
- **Send:** each attempt re-simulates first, then sends with exponential backoff and full jitter.
  Waiting for the receipt is retried on its own, so a failed wait never causes a second send.
- **Failure:** when retries run out, or a receipt comes back reverted, the keeper writes a
  `dead_letters` row and raises a `TX_FAILED` alert.
- **Restarts:** nothing is kept in memory between ticks, so a restart simply re-derives from chain
  state.

## Alerting

Alerts are logged and, when `ALERT_WEBHOOK_URL` is set, POSTed as JSON. Repeats of the same
(code, index, subject) are suppressed for `ALERT_COOLDOWN_MS`.

| Code | Trigger |
|---|---|
| `ADAPTER_UNHEALTHY` | A non-quarantined adapter is not healthy or its valuation fails |
| `NAV_UNHEALTHY` | `navHealthy=false` |
| `DEPOSITS_PAUSED`, `REDEMPTIONS_PAUSED`, `SHUTDOWN` | The matching vault flag is set |
| `QUEUE_STALE` | The oldest live open request is older than `QUEUE_AGE_ALERT_SECONDS` |
| `QUEUE_FLOOR_BLOCKED` | Requests are skipped because NAV is below their `minAssetsOut`; they wait for NAV or expiry |
| `LIQUIDITY_BELOW_BUFFER` | Free liquidity is below the buffer target |
| `TX_FAILED` | A transaction failed |
| `KEEPER_ERROR` | A tick failed |

## Deployment and rollback

- Build with `docker build -f services/backend/Dockerfile -t vectra-backend .` from the repo root.
  It is a multi-stage build that runs as the non-root `node` user. Run one container per process:
  - `CMD ["src/cli/api.ts"]`, `["src/cli/indexer.ts"]` or `["src/cli/keeper.ts"]`;
  - mount `/data` as a shared volume;
  - inject `KEEPER_PRIVATE_KEY` and `ADMIN_API_TOKEN` from a secret manager.
- Health checks: point liveness and readiness at `GET /health`. Alert on `vectra_indexed_block`
  stalling and on `vectra_dead_letters_open > 0`.
- **Rollback:** migrations are append-only. Rolling back the code is safe as long as no newer
  migration has been applied; otherwise restore the DB from backup. Because the DB is a cache, the
  last-resort recovery is to delete it, or run `rebuild --from-chain`, and let the indexer re-sync.
  Only `index_metadata` must be backed up separately.
- **Keeper rollout:** start in dry-run (no key), review `/v1/keeper/status`, then add the key. Turn
  on `KEEPER_ENABLE_DRIFT` only after watching dry-run decisions. Stopping the keeper is always safe:
  `processRedemptions` and `expireRedemption` are permissionless, and the vault stays solvent without bots.

## Tests

`pnpm --filter @vectra/backend test` runs:

- unit tests for reorg rewind and idempotency against a fake forkable chain, rebuild equivalence, the
  API (validation, auth, rate limiting, error shape, CORS, health), keeper decisions and alerts,
  retry/backoff/dead letters and lease exclusivity, and config;
- one anvil integration test on port 8546. It skips if anvil/forge are missing. It deploys
  LocalDemo, checks that `deployments/31337.json` is restored afterwards, and kills anvil.

## Known limitations

- SQLite means a single host. Rate limiting and alert de-duplication are per process.
- After a reorg, derived tables are rebuilt in full. That is simple and deterministic, but costs
  O(events). Fine at current scale.
- The keeper scans at most 200 queue entries from the head per read.
- Compliance-blocked requests (`RedemptionPaymentBlocked`) are not predicted off-chain. The no-op
  simulation check stops them from wasting gas.
- `user_activity` attributes queue-escrow transfers to request events, not to transfers.
