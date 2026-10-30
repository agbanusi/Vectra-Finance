# @vectra/web

Marketing site and dApp for Vectra Finance (Next.js 16 App Router, React 19, wagmi 3 + viem, Tailwind v4).

| Route | What it does |
| --- | --- |
| `/` | Landing page. Live protocol stats (TVL, number of indexes, best realised APY), featured indexes, how it works, security, FAQ. Everything numeric comes from chain. |
| `/app` | Markets. Stat strip (TVL, indexes, TVL-weighted realised APY, your deposits), a sortable table on desktop and cards on mobile, filter chips (curator style, category, permissionless or restricted) and search. |
| `/app/index/[address]` | Index page. Header (tags, contract link, add to wallet), KPI strip, price or NAV chart, allocation donut and strategy table, sticky Deposit/Withdraw card, your position, your requests (timeline, cancel, expire), Activity tab, and a Risk & details tab (withdrawal mechanics, compliance, parameters, contracts). |
| `/app/portfolio` | Portfolio summary, positions, withdrawal requests across indexes, activity history. |

Curation is headless (keepers and bots). The app has no curator or admin UI.

## Data sources

- **On-chain is the source of truth.** Index state comes from `IndexLens` (`getIndexes`, `getIndex`, `getUser`, `getRequests`, `previewDeposit`, `previewRedeem`). Indexes are discovered with `factory.allIndexes()`.
- **Realised APY is real.** It is the annualised growth of price per share, never a projection. Sources, in order:
  1. Backend snapshots (`NEXT_PUBLIC_API_URL` → `/v1/indexes/:address/history`), using nav/totalSupply for precision.
  2. Historical chain state. The app reads `totalNav`/`totalSupply` (and `convertToAssets(1e24)` for any ERC-4626 strategy vault) at `head − 7d`, then `24h`, `6h` and `1h`, clamped to the deployment `startBlock`. A pruned-history error (publicnode answers code `4444`) falls through to the next window. If a window reaches back before an index existed, the launch block is found by binary search and the result is labelled "since launch". Windows shorter than 30 minutes show "—".
  Every APY is shown with its window label ("7d", "24h", "since launch"), and a tooltip gives the time span and the source. See `src/lib/apy.ts`.
- **Charts** use API snapshots, or otherwise sample about 18 historical blocks. When the node prunes history, the samples are taken again inside the window the node can still serve, and the chart says so.
- **Activity** comes from the API when it is configured. Otherwise the app reads the wallet's `Deposited`/`Redeemed`/`Redemption*` logs from recent blocks, retrying with smaller ranges. If no range works, it shows an "unavailable" state.
- **Metadata** (curator style, category, description, risk tier, tags) is in `src/lib/metadata.ts`. It is keyed by `chainId:address`, falls back to the symbol, and is merged with backend `/v1/indexes` metadata when that is available. On testnet, curator labels describe a strategy style (for example "Gauntlet-style") and never an endorsement.

## Environment

Copy `.env.example` to `.env.local`. All of these are optional on Sepolia.

| Var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CHAIN_ID` | Target chain. Default `11155111` (Sepolia). Set `31337` for the local anvil demo. |
| `NEXT_PUBLIC_RPC_URL` | JSON-RPC. Default `https://ethereum-sepolia-rpc.publicnode.com` on Sepolia (keeps about 1.5 days of state) and `http://127.0.0.1:8545` on 31337. An archive RPC gives longer APY windows and charts. |
| `NEXT_PUBLIC_FACTORY`, `NEXT_PUBLIC_LENS` | Core addresses. On 11155111 and 31337 they fall back to `deployments/<chainId>.json`, which is bundled at build time together with `startBlock`, `baseAsset`, `testnet` and `strategyVaults`. |
| `NEXT_PUBLIC_EXPLORER_URL` | Explorer base URL. Default `https://sepolia.etherscan.io` on Sepolia. |
| `NEXT_PUBLIC_API_URL` | Optional enrichment backend. When it is unset, no API calls are made. |
| `NEXT_PUBLIC_WC_PROJECT_ID` | Optional. Adds WalletConnect to the wallet modal (also run `pnpm --filter @vectra/web add @walletconnect/ethereum-provider`). |

The header shows a network pill ("Sepolia"). Only chain 31337 also shows a "mock assets" label. On testnet deployments, the action card and the portfolio page offer **Get 10,000 tUSDC**, which calls the faucet `mint(to, amount)`.

## Design system

- Tokens live in `src/app/globals.css` (`@theme`). The base is deep navy-black with surfaces `surface`/`surface-2`/`surface-3` and subtle borders. There is one accent (Vectra blue `#3d6bff`) plus semantic success, warning, danger and info. Text tokens meet WCAG AA. The categorical chart palette (`--color-cat-1..6`) was checked with the dataviz palette validator on the dark surface.
- Type: Geist Sans and Geist Mono (`geist` package, self-hosted through `next/font`). All figures use tabular numerals (`.tabular`).
- Primitives are in `src/components/ui/`: Button, Card, Badge/Tag, Tooltip/InfoTip, Tabs (underline and segmented), Segmented, Popover, Dialog, Accordion, Kpi, Value (compact value with the precise amount in a tooltip), TokenIcon (generated monograms) and ProtocolIcon (abstract glyphs, not third-party logos), AllocationBar, Skeleton, and the empty, error and notice states.
- Number formatting is in `src/lib/format.ts`: compact currency (`$1.24M`, rounded down), the precise amount in tooltips, and percentages with 2dp.
- Wallet: a custom Radix modal lists EIP-6963 wallets (with a generic injected fallback), Coinbase Wallet, and WalletConnect when it is configured. RainbowKit and ConnectKit do not support wagmi 3. When the wallet is on another chain, a banner and the header button prompt a switch.
- Transaction lifecycle: `useTx` (simulate → sign → pending → confirmed/reverted) adds sonner toasts with explorer links. Every write goes through `writeWithGasBuffer` (+25% gas). Approvals are for the exact amount.
- Accessibility: skip link, visible focus rings, keyboard-operable Radix primitives, `aria-live` transaction status, `aria-sort` on table headers, and support for `prefers-reduced-motion`.

## Run

```bash
pnpm install
pnpm --filter @vectra/web dev                 # Sepolia by default → http://localhost:3000
NEXT_PUBLIC_CHAIN_ID=31337 pnpm --filter @vectra/web dev   # local anvil demo (pnpm dev:chain first)
```

## Scripts

- `dev` / `build` / `start` run on **webpack** (`--webpack`). `@vectra/sdk` ships TS source with `.js` specifiers, which webpack maps through `resolve.extensionAlias`.
- `typecheck` / `lint`: `tsc --noEmit` (strict).
- `test`: vitest + Testing Library. Covers APY (annualisation, the pruned-history fallback, launch-block search, snapshots), formatting, deposit and withdraw form states, the eligibility gate, faucet visibility, market filtering, sorting and stats, config and metadata resolution, the API client, the tx state machine, `useTx` and the gas buffer.
- `test:e2e`: Playwright smoke test (landing → markets, no horizontal overflow at 390px). Run `pnpm build` first.
