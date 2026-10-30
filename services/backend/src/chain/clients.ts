import { createPublicClient, defineChain, http, type Chain, type PublicClient } from "viem";
import { anvil } from "viem/chains";

const RPC_TIMEOUT_MS = 15_000;
const RPC_RETRY_COUNT = 2;

/** Builds a chain definition for any chain id; anvil gets its canonical definition. */
export function chainFor(chainId: number, rpcUrl: string): Chain {
  if (chainId === anvil.id) return { ...anvil, rpcUrls: { default: { http: [rpcUrl] } } };
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export function makePublicClient(chainId: number, rpcUrl: string): PublicClient {
  return createPublicClient({
    chain: chainFor(chainId, rpcUrl),
    transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS, retryCount: RPC_RETRY_COUNT, batch: true }),
  });
}
