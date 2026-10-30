# @vectra/web

Marketing site and dApp for Vectra Finance (Next.js 16 App Router, React 19, wagmi 3 + viem, Tailwind v4).

| Route | What it does |
| --- | --- |
| `/` | Landing page. The index preview is live from chain and shows an empty state when nothing is available. |
| `/app` | Explore indexes, with search and filters for curator, adapter kind, compliance and status. |
| `/app/index/[address]` | Composition, NAV history, liquidity terms, risks, eligibility, plus the deposit/redeem panels and your requests. |
| `/app/portfolio` | Balances (lens `getUser`), redemption requests and API transaction history. |
| `/app/curator` | Role-gated console: create index, deploy adapter, weights, liquidity, limits, fees, compliance (admin), pause controls, queue and keeper status. |

On-chain reads through `IndexLens` are the source of truth. The backend API is only used for enrichment (NAV history, activity, keeper status). If the API is down, the app shows explicit "unavailable" states instead of numbers.

## Environment

Copy `.env.example` to `.env.local`.

| Var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CHAIN_ID` | Target chain (default `31337`). |
| `NEXT_PUBLIC_RPC_URL` | JSON-RPC URL (default `http://127.0.0.1:8545` on 31337). |
| `NEXT_PUBLIC_FACTORY`, `NEXT_PUBLIC_LENS` | Core addresses. On 31337 only, these fall back to `deployments/31337.json`, which is bundled at build time. |
| `NEXT_PUBLIC_EXPLORER_URL` | Optional explorer base URL for address/tx links. |
| `NEXT_PUBLIC_API_URL` | Optional backend (default `http://localhost:8787`). |
| `NEXT_PUBLIC_WC_PROJECT_ID` | Optional. Enables WalletConnect. You also need `pnpm --filter @vectra/web add @walletconnect/ethereum-provider`. Without the provider package it is aliased away at build time. |

On chain 31337 with the mock demo deployment, every page shows a "Local demo — mock assets" banner.

## Run against the local anvil demo

```bash
pnpm install                       # repo root
pnpm dev:chain                     # anvil + LocalDemo deploy -> deployments/31337.json
pnpm --filter @vectra/backend dev  # optional, the enrichment API on :4000
pnpm --filter @vectra/web dev      # http://localhost:3000
```

Import an anvil dev key into your browser wallet and add network `http://127.0.0.1:8545` (chain id 31337). Redeploying the demo can change addresses. Rebuild or restart `dev` afterwards so the bundled JSON is picked up again.

## Adding a chain

Set `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_FACTORY`, `NEXT_PUBLIC_LENS` and (ideally) `NEXT_PUBLIC_EXPLORER_URL`, then rebuild. Indexes are discovered from `factory.allIndexes()`. The app targets a single chain per build (`src/lib/chain.ts`).

## Scripts

- `dev` / `build` / `start`: these run on **webpack** (`--webpack`). `@vectra/sdk` ships TS source with `.js` import specifiers. Turbopack cannot map those to `.ts`, while webpack can through `resolve.extensionAlias` (see `next.config.ts`).
- `typecheck` and `lint`: both run `tsc --noEmit`, strict. ESLint is not set up.
- `test`: vitest + Testing Library (jsdom), covering formatting, the redemption estimate view, deposit validation, the weights editor, the tx state machine and `useTx`, the API client's failure handling, config, and create-index validation.
- `test:e2e`: Playwright smoke test (landing → app). Run `pnpm build` and `npx playwright install chromium` first.

## Notes

- Every write calls `simulateContract` before the wallet prompt. Reverts decode to custom error names (vault, compliance and registry errors are merged into one ABI in `src/lib/abis.ts`).
- Approvals are for the exact amount.
- Role gating in the UI is for convenience only. The contracts enforce every permission.
