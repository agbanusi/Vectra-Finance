"use client";

import { formatValueCompact, formatValuePrecise } from "@/lib/format";
import { Tooltip } from "./Tooltip";
import { cn } from "./cn";

/** Compact base-asset value ("$1.24M") with the precise amount in a tooltip. */
export function Value({ value, decimals, symbol, className }: { value: bigint; decimals: number; symbol?: string; className?: string }) {
  return (
    <Tooltip content={formatValuePrecise(value, decimals, symbol)}>
      <span tabIndex={0} className={cn("tabular cursor-default rounded-sm", className)}>
        {formatValueCompact(value, decimals, symbol)}
      </span>
    </Tooltip>
  );
}
