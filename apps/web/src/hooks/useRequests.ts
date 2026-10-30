"use client";

import { indexLensAbi } from "@vectra/sdk";
import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { config } from "@/lib/config";
import type { RedemptionRequest } from "@/lib/types";
import { ZERO } from "./useIndexes";

/** How far back (in request ids) the UI scans for a wallet's history. */
export const REQUEST_LOOKBACK = 500n;

export interface RequestRow extends RedemptionRequest {
  id: bigint;
}

export function useRequests(vault: Address | null, nextRequestId: bigint | undefined, fromId?: bigint) {
  const to = nextRequestId ?? 0n;
  const from = fromId ?? (to > REQUEST_LOOKBACK ? to - REQUEST_LOOKBACK : 0n);
  const query = useReadContract({
    address: config.lens ?? ZERO,
    abi: indexLensAbi,
    functionName: "getRequests",
    args: [vault ?? ZERO, from, to],
    query: { enabled: Boolean(config.lens && vault && nextRequestId !== undefined), refetchInterval: 15_000 },
  });
  const rows = useMemo<RequestRow[]>(() => {
    const [ids, reqs] = query.data ?? [[], []];
    return reqs.map((r, i) => ({ ...r, id: ids[i] ?? 0n }));
  }, [query.data]);
  return { ...query, rows };
}

export function ownedBy(rows: readonly RequestRow[], owner: Address | undefined): RequestRow[] {
  if (!owner) return [];
  const lower = owner.toLowerCase();
  return rows.filter((r) => r.owner.toLowerCase() === lower).reverse();
}

/** The connected wallet's requests across many indexes, in one batched read. */
export function useMyRequestsAcross(indexes: readonly { vault: Address; nextRequestId: bigint }[], owner: Address | undefined) {
  const query = useReadContracts({
    contracts: indexes.map((v) => {
      const to = v.nextRequestId;
      const from = to > REQUEST_LOOKBACK ? to - REQUEST_LOOKBACK : 0n;
      return { address: config.lens ?? ZERO, abi: indexLensAbi, functionName: "getRequests" as const, args: [v.vault, from, to] as const };
    }),
    query: { enabled: Boolean(config.lens && owner && indexes.length > 0), refetchInterval: 15_000 },
  });
  const byVault = useMemo(() => {
    const out = new Map<string, RequestRow[]>();
    indexes.forEach((v, i) => {
      const r = query.data?.[i];
      if (r?.status !== "success") return;
      const [ids, reqs] = r.result as readonly [readonly bigint[], readonly RedemptionRequest[]];
      out.set(v.vault.toLowerCase(), ownedBy(reqs.map((req, k) => ({ ...req, id: ids[k] ?? 0n })), owner));
    });
    return out;
  }, [indexes, query.data, owner]);
  return { byVault, isLoading: query.isLoading };
}
