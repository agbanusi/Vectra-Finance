"use client";

import { indexLensAbi } from "@vectra/sdk";
import type { Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { config } from "@/lib/config";
import { ZERO } from "./useIndexes";

export function useUserPosition(vault: Address | null) {
  const { address } = useAccount();
  return useReadContract({
    address: config.lens ?? ZERO,
    abi: indexLensAbi,
    functionName: "getUser",
    args: [vault ?? ZERO, address ?? ZERO],
    query: { enabled: Boolean(config.lens && vault && address), refetchInterval: 15_000 },
  });
}

export function useUserPositions(vaults: readonly Address[]) {
  const { address } = useAccount();
  return useReadContracts({
    contracts: vaults.map((vault) => ({
      address: config.lens ?? ZERO,
      abi: indexLensAbi,
      functionName: "getUser" as const,
      args: [vault, address ?? ZERO] as const,
    })),
    query: { enabled: Boolean(config.lens && address && vaults.length > 0), refetchInterval: 20_000 },
  });
}
