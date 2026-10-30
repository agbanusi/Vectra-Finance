"use client";

import { erc20Abi, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { config } from "@/lib/config";
import { shortAddress } from "@/lib/explorer";

/** On-chain `name()`/`symbol()` of strategy vaults, falling back to deployment metadata, then the address. */
export function useStrategyNames(targets: readonly Address[]) {
  const res = useReadContracts({
    contracts: targets.flatMap((address) => [
      { address, abi: erc20Abi, functionName: "name" as const },
      { address, abi: erc20Abi, functionName: "symbol" as const },
    ]),
    query: { enabled: targets.length > 0, staleTime: Infinity },
  });
  const out: Record<string, { name: string; symbol: string | null }> = {};
  targets.forEach((t, i) => {
    const known = config.strategyVaults[t.toLowerCase()];
    const name = res.data?.[i * 2]?.result as string | undefined;
    const symbol = res.data?.[i * 2 + 1]?.result as string | undefined;
    out[t.toLowerCase()] = { name: name || known?.name || shortAddress(t), symbol: symbol || known?.symbol || null };
  });
  return { names: out, isLoading: res.isLoading };
}
