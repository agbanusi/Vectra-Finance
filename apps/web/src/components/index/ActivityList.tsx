"use client";

import { ArrowDownLeft, ArrowUpRight, Ban, CheckCircle2, Clock, ExternalLink, History, Hourglass, PieChart, type LucideIcon } from "lucide-react";
import type { ActivityEvent, ActivityKind, ActivityResult } from "@/hooks/useActivity";
import { explorerTxUrl } from "@/lib/explorer";
import { formatAmount, formatRelative, formatShares, formatTimestamp } from "@/lib/format";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState } from "../ui/States";
import { Tooltip } from "../ui/Tooltip";

const KIND: Record<ActivityKind, { label: string; icon: LucideIcon; tone: string }> = {
  deposit: { label: "Deposit", icon: ArrowDownLeft, tone: "text-success bg-success/10" },
  redeem: { label: "Withdraw", icon: ArrowUpRight, tone: "text-accent-strong bg-accent-soft" },
  request: { label: "Withdrawal requested", icon: Clock, tone: "text-warning bg-warning/10" },
  filled: { label: "Withdrawal filled", icon: CheckCircle2, tone: "text-success bg-success/10" },
  partial: { label: "Partially filled", icon: PieChart, tone: "text-info bg-info/10" },
  cancelled: { label: "Request cancelled", icon: Ban, tone: "text-muted bg-surface-3" },
  expired: { label: "Request expired", icon: Hourglass, tone: "text-muted bg-surface-3" },
};

interface Props {
  query: { data?: ActivityResult; isLoading: boolean; isError: boolean; error?: Error | null };
  decimals: number;
  symbol: string;
  indexLabel?: (vault: string | null) => string | null;
  emptyText?: string;
}

export function ActivityList({ query, decimals, symbol, indexLabel, emptyText = "No activity yet" }: Props) {
  if (query.isLoading) {
    return (
      <div className="divide-y divide-border">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-4 sm:px-6"><Skeleton className="size-9 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-40" /><Skeleton className="h-3 w-24" /></div></div>
        ))}
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <div className="p-5 sm:p-6"><ErrorState title="Activity unavailable" detail="The RPC node could not serve event logs for this range. Balances and positions are still read live from chain." /></div>;
  }
  const { events, source, fromBlock } = query.data;
  if (events.length === 0) {
    return <EmptyState icon={History} title={emptyText}>{source === "chain" ? `Scanned recent blocks${fromBlock !== null ? ` (from #${fromBlock.toLocaleString()})` : ""}.` : null}</EmptyState>;
  }
  return (
    <div>
      <ul className="divide-y divide-border">
        {events.map((e, i) => <Row key={`${e.txHash}-${e.kind}-${i}`} e={e} decimals={decimals} symbol={symbol} indexLabel={indexLabel} />)}
      </ul>
      <p className="border-t border-border px-5 py-3 text-xs text-subtle sm:px-6">
        {source === "api" ? "From the Vectra indexer." : `From on-chain event logs since block #${fromBlock?.toLocaleString() ?? "—"}.`}
      </p>
    </div>
  );
}

function Row({ e, decimals, symbol, indexLabel }: { e: ActivityEvent; decimals: number; symbol: string; indexLabel?: Props["indexLabel"] }) {
  const k = KIND[e.kind];
  const Icon = k.icon;
  const url = e.txHash ? explorerTxUrl(e.txHash) : null;
  const sub = indexLabel?.(e.vault);
  return (
    <li className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${k.tone}`}><Icon className="size-4" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{k.label}{e.requestId !== null ? <span className="font-normal text-subtle"> #{e.requestId.toString()}</span> : null}</p>
        <p className="truncate text-xs text-subtle">
          {sub ? <>{sub} · </> : null}
          {e.timestamp ? (
            <Tooltip content={formatTimestamp(e.timestamp)}><span tabIndex={0}>{formatRelative(e.timestamp)}</span></Tooltip>
          ) : e.block !== null ? `Block #${e.block.toLocaleString()}` : "—"}
        </p>
      </div>
      <div className="text-right">
        {e.assets !== null ? <p className="tabular text-sm font-medium text-fg">{formatAmount(e.assets, decimals, 2)} {symbol}</p> : null}
        {e.shares !== null ? <p className="tabular text-xs text-subtle">{formatShares(e.shares, 2)} shares</p> : null}
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" aria-label="View transaction on explorer" className="rounded-md p-1.5 text-subtle transition-colors hover:bg-surface-3 hover:text-fg">
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </li>
  );
}
