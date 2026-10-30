"use client";

import { indexFactoryAbi, indexLensAbi } from "@vectra/sdk";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { config } from "@/lib/config";
import type { IndexView } from "@/lib/types";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export interface IndexesResult {
  configured: boolean;
  indexes: readonly IndexView[];
  isLoading: boolean;
  error: Error | null;
}

/** Discovers indexes from the factory, then reads them through the lens (authoritative). */
export function useIndexes(): IndexesResult {
  const configured = Boolean(config.factory && config.lens);
  const addresses = useReadContract({
    address: config.factory ?? ZERO,
    abi: indexFactoryAbi,
    functionName: "allIndexes",
    query: { enabled: configured, refetchInterval: 30_000 },
  });
  const list = addresses.data ?? [];
  const views = useReadContract({
    address: config.lens ?? ZERO,
    abi: indexLensAbi,
    functionName: "getIndexes",
    args: [list],
    query: { enabled: configured && list.length > 0, refetchInterval: 15_000 },
  });
  const empty = addresses.isSuccess && list.length === 0;
  return {
    configured,
    indexes: empty ? [] : (views.data ?? []),
    isLoading: configured && (addresses.isLoading || (!empty && views.isLoading)),
    error: addresses.error ?? views.error ?? null,
  };
}

export function useIndex(vault: Address | null) {
  return useReadContract({
    address: config.lens ?? ZERO,
    abi: indexLensAbi,
    functionName: "getIndex",
    args: [vault ?? ZERO],
    query: { enabled: Boolean(config.lens && vault), refetchInterval: 15_000 },
  });
}

export { ZERO };
