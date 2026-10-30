"use client";

import { erc20Abi, type Address } from "viem";
import { useReadContracts } from "wagmi";

export interface TokenInfo {
  symbol: string;
  decimals: number | undefined;
  name: string | undefined;
}

export function useTokenInfo(token: Address | undefined): TokenInfo {
  const { data } = useReadContracts({
    contracts: [
      { address: token, abi: erc20Abi, functionName: "symbol" },
      { address: token, abi: erc20Abi, functionName: "decimals" },
      { address: token, abi: erc20Abi, functionName: "name" },
    ],
    query: { enabled: Boolean(token), staleTime: Infinity },
  });
  return {
    symbol: (data?.[0]?.result as string | undefined) ?? "USDC",
    decimals: data?.[1]?.result as number | undefined,
    name: data?.[2]?.result as string | undefined,
  };
}

export function useTokenSymbol(token: Address | undefined): string {
  return useTokenInfo(token).symbol;
}
