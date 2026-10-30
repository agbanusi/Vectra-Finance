"use client";

import type { ApyResult } from "@/lib/apy";
import { formatPct, formatTimestamp } from "@/lib/format";
import { Skeleton } from "../ui/Skeleton";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../ui/cn";

export function apyTooltip(apy: ApyResult | null): string {
  if (!apy) return "Not enough price history yet. Realised APY appears once price-per-share can be compared across time.";
  const src = apy.source === "api" ? "indexed snapshots" : "on-chain state";
  return `Annualised growth of price per share over ${apy.label === "since launch" ? "the period since launch" : `the last ${apy.label}`} (${formatTimestamp(apy.fromTimestamp)} → now), from ${src}. Net of fees. Historical, not a forecast.`;
}

/** Realised APY with its measurement window. Never shows an invented number. */
export function ApyCell({ apy, loading, align = "right", size = "md" }: { apy: ApyResult | null; loading?: boolean; align?: "left" | "right"; size?: "md" | "lg" }) {
  if (loading && !apy) return <Skeleton className={cn("h-5 w-16", align === "right" && "ml-auto")} />;
  return (
    <Tooltip content={apyTooltip(apy)}>
      <span tabIndex={0} className={cn("inline-flex cursor-default flex-col rounded-sm", align === "right" ? "items-end" : "items-start")}>
        <span className={cn("tabular font-semibold", size === "lg" ? "text-xl" : "text-sm", apy ? (apy.apy >= 0 ? "text-success" : "text-danger") : "text-subtle")}>
          {apy ? formatPct(apy.apy) : "—"}
        </span>
        <span className="whitespace-nowrap text-[11px] leading-4 text-subtle">{apy ? apy.label : "no history yet"}</span>
      </span>
    </Tooltip>
  );
}
