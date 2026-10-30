import type { ReactNode } from "react";
import { cn } from "./cn";
import { InfoTip } from "./Tooltip";
import { Skeleton } from "./Skeleton";

/** Label + large tabular value + optional sub line. */
export function Kpi({ label, value, sub, info, loading, size = "md", className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; info?: ReactNode; loading?: boolean; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="flex items-center gap-1.5 text-xs font-medium text-subtle">
        {label}
        {info ? <InfoTip>{info}</InfoTip> : null}
      </dt>
      <dd className={cn("tabular mt-1.5 truncate font-semibold tracking-tight text-fg", size === "lg" ? "text-[28px] leading-8" : size === "md" ? "text-xl leading-7" : "text-base leading-6")}>
        {loading ? <Skeleton className={cn("w-24", size === "lg" ? "h-8" : "h-7")} /> : value}
      </dd>
      {sub ? <dd className="mt-1 truncate text-xs text-muted">{sub}</dd> : null}
    </div>
  );
}
