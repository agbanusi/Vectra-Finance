import type { ReactNode } from "react";
import { Kpi } from "../ui/Kpi";

export interface StripItem {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  info?: ReactNode;
  loading?: boolean;
}

export function StatStrip({ items }: { items: readonly StripItem[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-xl)] border border-border bg-border shadow-[var(--shadow-card)] lg:grid-cols-4">
      {items.map((it) => (
        <Kpi key={it.label} className="bg-surface px-4 py-4 sm:px-6 sm:py-5" label={it.label} value={it.value} sub={it.sub} info={it.info} loading={it.loading} size="lg" />
      ))}
    </dl>
  );
}
