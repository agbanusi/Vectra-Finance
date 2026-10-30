"use client";

import { useQuery } from "@tanstack/react-query";
import { indexVaultAbi } from "@vectra/sdk";
import { getAbiItem, type Address, type Hash, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { api, apiEnabled, type ActivityItem } from "@/lib/api";
import { config } from "@/lib/config";

export type ActivityKind = "deposit" | "redeem" | "request" | "filled" | "partial" | "cancelled" | "expired";

export interface ActivityEvent {
  kind: ActivityKind;
  vault: Address | null;
  txHash: Hash | null;
  block: bigint | null;
  timestamp: number | null;
  assets: bigint | null;
  shares: bigint | null;
  requestId: bigint | null;
}

export interface ActivityResult {
  events: ActivityEvent[];
  source: "api" | "chain";
  /** Block the on-chain scan started from (null for API data). */
  fromBlock: bigint | null;
}

const API_KIND: Record<string, ActivityKind> = {
  deposit: "deposit",
  deposited: "deposit",
  redeem: "redeem",
  redeemed: "redeem",
  redemption_requested: "request",
  redemptionrequested: "request",
  redemption_filled: "filled",
  redemptionfilled: "filled",
  redemption_partially_filled: "partial",
  redemptionpartiallyfilled: "partial",
  redemption_cancelled: "cancelled",
  redemptioncancelled: "cancelled",
  redemption_expired: "expired",
  redemptionexpired: "expired",
};

function big(v: string | null | undefined): bigint | null {
  try {
    return v !== null && v !== undefined && /^\d+$/.test(String(v)) ? BigInt(v) : null;
  } catch {
    return null;
  }
}

export function fromApi(item: ActivityItem): ActivityEvent | null {
  const kind = API_KIND[item.kind.toLowerCase().replace(/[\s-]/g, "_")] ?? API_KIND[item.kind.toLowerCase()];
  if (!kind) return null;
  return {
    kind,
    vault: (item.indexAddress as Address | undefined) ?? null,
    txHash: (item.txHash as Hash | undefined) ?? null,
    block: item.blockNumber !== undefined ? BigInt(item.blockNumber) : null,
    timestamp: item.timestamp ?? null,
    assets: big(item.assets),
    shares: big(item.shares),
    requestId: big(item.requestId ?? undefined),
  };
}

/** How far back the on-chain fallback scans; public RPCs bound `eth_getLogs` ranges. */
const LOG_WINDOWS = [45_000n, 10_000n, 2_000n];

const EVENTS = {
  deposit: { event: getAbiItem({ abi: indexVaultAbi, name: "Deposited" }), arg: "receiver" },
  redeem: { event: getAbiItem({ abi: indexVaultAbi, name: "Redeemed" }), arg: "owner" },
  request: { event: getAbiItem({ abi: indexVaultAbi, name: "RedemptionRequested" }), arg: "owner" },
  filled: { event: getAbiItem({ abi: indexVaultAbi, name: "RedemptionFilled" }), arg: "receiver" },
  partial: { event: getAbiItem({ abi: indexVaultAbi, name: "RedemptionPartiallyFilled" }), arg: "receiver" },
  cancelled: { event: getAbiItem({ abi: indexVaultAbi, name: "RedemptionCancelled" }), arg: "recipient" },
  expired: { event: getAbiItem({ abi: indexVaultAbi, name: "RedemptionExpired" }), arg: "recipient" },
} as const;

type LogArgs = { assets?: bigint; shares?: bigint; assetsPaid?: bigint; sharesBurned?: bigint; requestId?: bigint };

async function scanLogs(client: PublicClient, wallet: Address | null, vaults: readonly Address[], fromBlock: bigint, toBlock: bigint, kinds?: readonly ActivityKind[]) {
  const batches = await Promise.all(
    (Object.entries(EVENTS) as [ActivityKind, (typeof EVENTS)[keyof typeof EVENTS]][])
      .filter(([kind]) => !kinds || kinds.includes(kind))
      .map(async ([kind, { event, arg }]) => {
      const logs = await client.getLogs({ address: [...vaults], event, args: (wallet ? { [arg]: wallet } : undefined) as never, fromBlock, toBlock });
      return logs.map((log): ActivityEvent => {
        const a = (log as unknown as { args: LogArgs }).args;
        return {
          kind,
          vault: log.address,
          txHash: log.transactionHash,
          block: log.blockNumber,
          timestamp: null,
          assets: a.assets ?? a.assetsPaid ?? null,
          shares: a.shares ?? a.sharesBurned ?? null,
          requestId: a.requestId ?? null,
        };
      });
    }),
  );
  return batches.flat();
}

async function withTimestamps(client: PublicClient, events: ActivityEvent[]): Promise<ActivityEvent[]> {
  const blocks = [...new Set(events.map((e) => e.block).filter((b): b is bigint => b !== null))].slice(0, 60);
  const stamps = new Map<bigint, number>();
  await Promise.all(
    blocks.map(async (b) => {
      try {
        stamps.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp));
      } catch {
        // Leave the timestamp unknown; the row still shows the block.
      }
    }),
  );
  return events.map((e) => ({ ...e, timestamp: e.block !== null ? (stamps.get(e.block) ?? null) : null }));
}

/** Wallet activity: indexer API when configured, otherwise the wallet's vault events from recent chain logs. */
export function useWalletActivity(wallet: Address | undefined, vaults: readonly Address[]) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["activity", config.chainId, wallet, vaults.join(",")],
    enabled: Boolean(wallet) && vaults.length > 0,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<ActivityResult> => {
      if (!wallet) return { events: [], source: "chain", fromBlock: null };
      if (apiEnabled) {
        const res = await api.walletActivity(wallet);
        if (res.ok) {
          const events = res.data.map(fromApi).filter((e): e is ActivityEvent => e !== null);
          return { events: sortEvents(events), source: "api", fromBlock: null };
        }
      }
      if (!client) throw new Error("No RPC client");
      const head = await client.getBlockNumber();
      let lastError: unknown = null;
      for (const span of LOG_WINDOWS) {
        const fromBlock = head - span < config.startBlock ? config.startBlock : head - span;
        try {
          const events = await withTimestamps(client, await scanLogs(client, wallet, vaults, fromBlock, head));
          return { events: sortEvents(events), source: "chain", fromBlock };
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Could not read activity logs");
    },
  });
}

export function sortEvents(events: readonly ActivityEvent[]): ActivityEvent[] {
  return [...events].sort((a, b) => {
    if (a.block !== null && b.block !== null && a.block !== b.block) return a.block > b.block ? -1 : 1;
    return (b.timestamp ?? 0) - (a.timestamp ?? 0);
  });
}

/** Recent activity for one index (all wallets): API when configured, else recent chain logs. */
export function useIndexActivity(vault: Address) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["index-activity", config.chainId, vault],
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<ActivityResult> => {
      if (apiEnabled) {
        const res = await api.indexActivity(vault);
        if (res.ok) return { events: sortEvents(res.data.map(fromApi).filter((e): e is ActivityEvent => e !== null)).slice(0, 50), source: "api", fromBlock: null };
      }
      if (!client) throw new Error("No RPC client");
      const head = await client.getBlockNumber();
      let lastError: unknown = null;
      for (const span of LOG_WINDOWS) {
        const fromBlock = head - span < config.startBlock ? config.startBlock : head - span;
        try {
          const logs = await scanLogs(client, null, [vault], fromBlock, head, ["deposit", "redeem", "request", "filled", "partial"]);
          const events = await withTimestamps(client, sortEvents(logs).slice(0, 40));
          return { events, source: "chain", fromBlock };
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Could not read activity logs");
    },
  });
}
