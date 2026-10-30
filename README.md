# Vectra Finance

Index tokens backed by curated DeFi and RWA vaults. One ERC-20 gives diversified exposure to a basket of
ERC-4626 positions (Morpho, Euler, RWA, generic 4626), with an instant-redemption liquidity buffer and a
fair FIFO queue when positions must be unwound.

> **Status: unaudited.** Live on Sepolia testnet (addresses below) with faucet assets and testnet strategy vaults.
> No mainnet deployment. See [docs/threat-model.md](docs/threat-model.md) before
> handling real funds.

## Sepolia deployment (testnet)

Chain ID 11155111 · deployed from block 12023081 · full record in [`deployments/11155111.json`](deployments/11155111.json).
Admin, curator, guardian and keeper roles are all held by the deployer `0xCfb24D0cd266F6a8C8F7D2833AB7AbAc831445b9` (testnet only).

### Index tokens

| Symbol | Name | Type | Basket (target weights) | Buffer | Access | Address (= token) |
|---|---|---|---|---|---|---|
| **EDGE-INDEX** | Edge Curated USDC Index | Curator | Edge-style Morpho 55% · Edge-style Euler 45% | 10% | Permissionless | [`0xB2511e0d41ac26867fbe7Ad804A89552F3956FB1`](https://sepolia.etherscan.io/address/0xB2511e0d41ac26867fbe7Ad804A89552F3956FB1) |
| **GAUNTLET-INDEX** | Gauntlet Curated USDC Index | Curator | Gauntlet-style Prime 35% · Core 25% · Frontier 15% · Euler 25% | 10% | Permissionless | [`0x8D70694a167cE9130efE905c3C8374fB4e7E4E4F`](https://sepolia.etherscan.io/address/0x8D70694a167cE9130efE905c3C8374fB4e7E4E4F) |
| **GAUNTLET-MORPHO-INDEX** | Gauntlet Morpho USDC Index | Curator + protocol | Gauntlet-style Prime 50% · Core 30% · Frontier 20% (Morpho only) | 8% | Permissionless | [`0x1Fc0C516cb6eb030C778e4C0C8196D8c9c3A4bEc`](https://sepolia.etherscan.io/address/0x1Fc0C516cb6eb030C778e4C0C8196D8c9c3A4bEc) |
| **vSAFE** | Conservative USDC Yield | Strategy | Gauntlet-style Prime 40% · T-Bill RWA 40% · Edge-style Morpho 20% | 15% | Permissionless | [`0xb06eD3F102F665f609F6b6812c62b6c2a24D8d68`](https://sepolia.etherscan.io/address/0xb06eD3F102F665f609F6b6812c62b6c2a24D8d68) |
| **vMAXY** | High Yield USDC Blend | Strategy | Gauntlet-style Frontier 40% · Edge-style Euler 35% · Private Credit 25% | 10% | Permissionless | [`0x6905568c145bE7CA020bd0235B9A712cadE9cA8d`](https://sepolia.etherscan.io/address/0x6905568c145bE7CA020bd0235B9A712cadE9cA8d) |
| **RWA-INDEX** | Tokenized Treasury & Credit Index | RWA | T-Bill 70% · Private Credit 30% | 5% | Restricted (allowlist) | [`0x261a5a9fc8dcb421e46C1d3E024e5d0a43aAF78c`](https://sepolia.etherscan.io/address/0x261a5a9fc8dcb421e46C1d3E024e5d0a43aAF78c) |

All indexes settle in tUSDC, charge 0.5%/yr management + 10% performance fees, have a 7-day redemption TTL and partial fills enabled. RWA-INDEX deposits require allowlisting by the attestor (the deployer) via `AllowlistCompliance.setEligibility`.

### Strategy vaults (testnet emulations)

These are `TestnetYieldVault` contracts ([source](script/testnet/TestnetYieldVault.sol)): standard ERC-4626 vaults that accrue yield at a fixed rate so NAV and realised APY move on testnet. **They emulate curator strategy styles for demonstration and are not deployed by, or affiliated with, Gauntlet, Edge or any issuer.** Every one is approved as a target in the AdapterRegistry.

| Strategy | Symbol | Emulated APR | Address |
|---|---|---|---|
| Edge-style Euler Prime USDC (testnet) | `teeUSDC` | 7.60% | [`0x0B6C3C25e7dBA30684A32c1bfaFc6146dDfD0A3f`](https://sepolia.etherscan.io/address/0x0B6C3C25e7dBA30684A32c1bfaFc6146dDfD0A3f) |
| Edge-style USDC Morpho (testnet) | `teUSDCm` | 6.70% | [`0x6d29123F6f4D98491305D62bbEE777d0CfE18840`](https://sepolia.etherscan.io/address/0x6d29123F6f4D98491305D62bbEE777d0CfE18840) |
| Gauntlet-style Euler USDC (testnet) | `tgeUSDC` | 7.10% | [`0x272588037F4f35aB3b4FDe1406597209169CF12F`](https://sepolia.etherscan.io/address/0x272588037F4f35aB3b4FDe1406597209169CF12F) |
| Gauntlet-style USDC Core (testnet) | `tgUSDCc` | 6.40% | [`0xE2cb3D58230B33DC755Eca6b52D213a1222C4a66`](https://sepolia.etherscan.io/address/0xE2cb3D58230B33DC755Eca6b52D213a1222C4a66) |
| Gauntlet-style USDC Frontier (testnet) | `tgUSDCf` | 9.10% | [`0x82367C09070b9590f5636c48B17db4896286D69B`](https://sepolia.etherscan.io/address/0x82367C09070b9590f5636c48B17db4896286D69B) |
| Gauntlet-style USDC Prime (testnet) | `tgUSDCp` | 5.20% | [`0x21ed47Ac5fAB5bf0666FF12c2d8787F320754A39`](https://sepolia.etherscan.io/address/0x21ed47Ac5fAB5bf0666FF12c2d8787F320754A39) |
| Private Credit Vault (testnet) | `tCREDIT` | 10.50% | [`0xe7f9C2e9352F740Ecd69384F8694F0739a61c68C`](https://sepolia.etherscan.io/address/0xe7f9C2e9352F740Ecd69384F8694F0739a61c68C) |
| Tokenized T-Bill Vault (testnet) | `tTBILL` | 4.80% | [`0x87aAd8184bbc5Ff0Fbd39c5BA6F327370Cc91D14`](https://sepolia.etherscan.io/address/0x87aAd8184bbc5Ff0Fbd39c5BA6F327370Cc91D14) |

### Core contracts

| Contract | Address |
|---|---|
| IndexFactory | [`0x535D143ef9A047e4b2250c711f5CbFd28125e0f7`](https://sepolia.etherscan.io/address/0x535D143ef9A047e4b2250c711f5CbFd28125e0f7) |
| IndexVault implementation | [`0xC14F42D29413527a5ca60AeB833eebb7F040D51a`](https://sepolia.etherscan.io/address/0xC14F42D29413527a5ca60AeB833eebb7F040D51a) |
| AdapterRegistry | [`0x6eD7EdBf05A6A30A21115905DBd2a29966E760B4`](https://sepolia.etherscan.io/address/0x6eD7EdBf05A6A30A21115905DBd2a29966E760B4) |
| IndexLens | [`0x2281E219235D43469dAf0ae1378FE49c1aabC474`](https://sepolia.etherscan.io/address/0x2281E219235D43469dAf0ae1378FE49c1aabC474) |
| PermissionlessCompliance | [`0xE703520C9a26912282621C8B31bb9f6167372FF2`](https://sepolia.etherscan.io/address/0xE703520C9a26912282621C8B31bb9f6167372FF2) |
| AllowlistCompliance (RWA-INDEX) | [`0x40a95307A9BE281A0631140607723C46ce4683E4`](https://sepolia.etherscan.io/address/0x40a95307A9BE281A0631140607723C46ce4683E4) |
| ERC4626Adapter impl | [`0x2b5dE9dce49034c17608159D0d2bB1dbc3079732`](https://sepolia.etherscan.io/address/0x2b5dE9dce49034c17608159D0d2bB1dbc3079732) |
| MorphoVaultAdapter impl | [`0x0bED9cbA10e5C0d4d07b7F14F6652D6E1c8ED61d`](https://sepolia.etherscan.io/address/0x0bED9cbA10e5C0d4d07b7F14F6652D6E1c8ED61d) |
| EulerVaultAdapter impl | [`0x73D4c2C6f7fEFEa12C25314c161330120C43bc44`](https://sepolia.etherscan.io/address/0x73D4c2C6f7fEFEa12C25314c161330120C43bc44) |
| RWAAdapter impl | [`0x5141796534e3027E7918b8fc5dD2Fca618Dd63e9`](https://sepolia.etherscan.io/address/0x5141796534e3027E7918b8fc5dD2Fca618Dd63e9) |
| tUSDC (faucet test token, 6 dp) | [`0xcEDBe2F85F06d952905EcEB3D00f9EA034b68686`](https://sepolia.etherscan.io/address/0xcEDBe2F85F06d952905EcEB3D00f9EA034b68686) |

Get test USDC from the faucet: `cast send <tUSDC> "mint(address,uint256)" <you> 10000000000 --rpc-url <sepolia>` (max 100,000 tUSDC per call), or use the app's faucet button. Contracts are not yet verified on Etherscan (needs an `ETHERSCAN_API_KEY`: `forge verify-contract`).

Redeploy with `forge script script/TestnetDeploy.s.sol --rpc-url <sepolia> --private-key <key> --broadcast --slow --gas-estimate-multiplier 800` — see the gas note in [docs/runbook.md](docs/runbook.md).

## Repository

| Path | What |
|---|---|
| `src/` | Solidity: `IndexVault` (vault = index token), `IndexFactory`, `AdapterRegistry`, adapters, compliance, `IndexLens` |
| `test/` | Foundry unit, fuzz, invariant and opt-in fork tests |
| `script/` | `DeployCore`, `CreateIndex` (JSON-configured), `TestnetDeploy` (public testnets), `LocalDemo` + `DemoYield` (anvil, mock assets only) |
| `packages/sdk` | `@vectra/sdk`: generated ABIs, deployment parsing, shared maths and types |
| `services/backend` | Indexer, REST API and keeper bot (Node 22, SQLite, viem, Hono) |
| `apps/web` | Landing page and dApp (Next.js 16, wagmi, Tailwind) |
| `docs/` | [Architecture](docs/architecture.md) · [Threat model](docs/threat-model.md) · [Runbook](docs/runbook.md) |

## Quick start (local, mock assets)

Requires Foundry, Node ≥ 22 and pnpm 10.

```sh
pnpm install
forge build && node scripts/export-abis.mjs

# 1. Chain + demo deployment (writes deployments/31337.json)
pnpm dev:chain

# 2. Backend (separate terminals); see services/backend/.env.example
cd services/backend
export RPC_URL=http://127.0.0.1:8545 CHAIN_ID=31337 DEPLOYMENT_FILE=../../deployments/31337.json \
  DATABASE_PATH=./data/vectra.db ADMIN_API_TOKEN=$(openssl rand -hex 24) \
  KEEPER_PRIVATE_KEY=<anvil account #1 key, printed by anvil>
pnpm migrate && pnpm start:indexer   # + pnpm start:api, pnpm start:keeper

# 3. Web app (http://localhost:3000)
cd apps/web && pnpm dev
```

Optional: `forge script script/DemoYield.s.sol --rpc-url http://127.0.0.1:8545 --private-key <anvil key 0> --broadcast`
simulates yield so NAV history moves.

## Checks

```sh
forge fmt --check && forge build --sizes && forge test      # contracts (FOUNDRY_PROFILE=ci for long fuzz/invariants)
pnpm -r typecheck && pnpm -r test && pnpm -r build          # TypeScript packages
```

CI runs all of the above (`.github/workflows/ci.yml`) and fails if any contract exceeds EIP-170 or the
generated ABIs drift from the contracts.

## Production deployment

See [docs/runbook.md](docs/runbook.md): deploy core with `VECTRA_ADMIN` set to a timelocked multisig,
have governance approve vetted underlying vaults (`AdapterRegistry.setTargetApproved`), create indexes
from reviewed JSON configs, seed them, grant `KEEPER_ROLE` to the bot, then start the backend and web
with environment-specific config.
