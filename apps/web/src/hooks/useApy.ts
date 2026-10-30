"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address, PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { api, apiEnabled } from "@/lib/api";
import { apyFromSnapshots, computeChainApys, sampleBlocks, type ApyResult } from "@/lib/apy";
import { BLOCK_TIME_SECONDS } from "@/lib/chain";
import { config } from "@/lib/config";
import { snapshotSeries, toSnapshotPoints, type SeriesPoint } from "@/lib/history";
import { blockTimestamp, navPointRatio, readIndexNavs, readVaultRatios } from "@/lib/onchain";
import { isPrunedHistoryError } from "@/lib/rpc";
import { toNumber } from "@/lib/format";

const STALE = 5 * 60_000;

async function head(client: PublicClient) {
  const b = await client.getBlock();
  return { block: b.number, timestamp: Number(b.timestamp) };
}

async function chainApys(client: PublicClient, targets: readonly Address[], read: (block: bigint, t: readonly Address[]) => Promise<readonly (number | null)[]>) {
  const h = await head(client);
  const current = await read(h.block, targets);
  return computeChainApys(targets, {
    head: h,
    startBlock: config.startBlock,
    blockTime: BLOCK_TIME_SECONDS,
    current,
    readMany: read,
    timestampOf: (b) => blockTimestamp(client, b),
  });
}

/** Snapshot-based APY per index from the API, or null when unavailable. */
async function apiApy(vault: Address, baseDecimals: number): Promise<ApyResult | null> {
  if (!apiEnabled) return null;
  const from = Math.floor(Date.now() / 1000) - 8 * 86_400;
  const res = await api.indexHistory(vault, from);
  if (!res.ok) return null;
  return apyFromSnapshots(toSnapshotPoints(snapshotSeries(res.data, baseDecimals)));
}

export interface IndexApyInput {
  vault: Address;
  baseDecimals: number;
}

/** Realised APY per index: API snapshots first, otherwise historical chain state. */
export function useIndexApys(indexes: readonly IndexApyInput[]) {
  const client = usePublicClient();
  const key = indexes.map((i) => i.vault).join(",");
  return useQuery({
    queryKey: ["apy", "indexes", config.chainId, key],
    enabled: Boolean(client) && indexes.length > 0,
    staleTime: STALE,
    refetchInterval: STALE,
    retry: 1,
    queryFn: async (): Promise<Record<string, ApyResult | null>> => {
      const fromApi = await Promise.all(indexes.map((i) => apiApy(i.vault, i.baseDecimals)));
      const missing = indexes.filter((_, k) => fromApi[k] === null).map((i) => i.vault);
      const out: Record<string, ApyResult | null> = {};
      indexes.forEach((i, k) => (out[i.vault] = fromApi[k] ?? null));
      if (missing.length > 0 && client) {
        const chain = await chainApys(client, missing, async (b, t) => (await readIndexNavs(client, b, t)).map(navPointRatio));
        missing.forEach((v, k) => (out[v] = chain[k] ?? null));
      }
      return out;
    },
  });
}

/** Realised APY of underlying ERC-4626 strategy vaults (generic `convertToAssets` growth). */
export function useStrategyApys(targets: readonly Address[]) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["apy", "strategies", config.chainId, targets.join(",")],
    enabled: Boolean(client) && targets.length > 0,
    staleTime: STALE,
    retry: 1,
    queryFn: async (): Promise<Record<string, ApyResult | null>> => {
      if (!client) return {};
      const res = await chainApys(client, targets, (b, t) => readVaultRatios(client, b, t));
      return Object.fromEntries(targets.map((t, k) => [t.toLowerCase(), res[k] ?? null]));
    },
  });
}

export type ChartRange = "24h" | "7d" | "30d" | "all";
export const CHART_RANGE_SECONDS: Record<ChartRange, number | null> = { "24h": 86_400, "7d": 7 * 86_400, "30d": 30 * 86_400, all: null };

export interface PerformanceData {
  series: SeriesPoint[];
  source: "api" | "chain";
  /** True when the node could not serve the full requested range (pruned history). */
  truncated: boolean;
}

const CHAIN_SAMPLES = 18;

/** Price-per-share / NAV series: API snapshots, else sampled historical blocks within the RPC's window. */
export function usePerformance(vault: Address, baseDecimals: number, range: ChartRange) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["performance", config.chainId, vault, range],
    enabled: Boolean(client),
    staleTime: STALE,
    retry: 1,
    queryFn: async (): Promise<PerformanceData> => {
      const seconds = CHART_RANGE_SECONDS[range];
      if (apiEnabled) {
        const from = seconds === null ? undefined : Math.floor(Date.now() / 1000) - seconds;
        const res = await api.indexHistory(vault, from);
        if (res.ok) {
          const series = snapshotSeries(res.data, baseDecimals);
          if (series.length >= 2) return { series, source: "api", truncated: false };
        }
      }
      if (!client) return { series: [], source: "chain", truncated: false };
      const h = await head(client);
      const blocks = sampleBlocks(h.block, config.startBlock, seconds, BLOCK_TIME_SECONDS, CHAIN_SAMPLES);
      let truncated = false;
      const sample = async (list: readonly bigint[]) => {
        const points = await Promise.all(
          list.map(async (block): Promise<(SeriesPoint & { block: bigint }) | null> => {
            try {
              const [p] = await readIndexNavs(client, block, [vault]);
              const ratio = navPointRatio(p ?? null);
              if (!p || ratio === null) return null;
              const t = block === h.block ? h.timestamp : await blockTimestamp(client, block);
              return { block, t, pps: ratio * 10 ** (18 - baseDecimals), nav: toNumber(p.nav, baseDecimals) };
            } catch (err) {
              if (isPrunedHistoryError(err)) truncated = true;
              return null;
            }
          }),
        );
        return points.filter((p): p is SeriesPoint & { block: bigint } => p !== null);
      };
      let points = await sample(blocks);
      // Pruned history (public RPCs keep ~1.5 days): resample densely within the window the node can serve.
      const oldest = points[0];
      if (points.length < CHAIN_SAMPLES / 2 && oldest && oldest.block < h.block) {
        const dense = sampleBlocks(h.block, oldest.block, null, BLOCK_TIME_SECONDS, CHAIN_SAMPLES).filter((b) => !points.some((p) => p.block === b));
        points = [...points, ...(await sample(dense))];
      }
      const series = points.map(({ t, pps, nav }) => ({ t, pps, nav })).sort((a, b) => a.t - b.t);
      return { series, source: "chain", truncated };
    },
  });
}
