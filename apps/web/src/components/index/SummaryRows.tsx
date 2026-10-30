import type { ReactNode } from "react";
import { InfoTip } from "../ui/Tooltip";

export function SummaryRows({ rows }: { rows: readonly { label: string; value: ReactNode; info?: ReactNode; strong?: boolean }[] }) {
  return (
    <dl className="space-y-2.5 text-[13px]">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-subtle">
            {r.label}
            {r.info ? <InfoTip>{r.info}</InfoTip> : null}
          </dt>
          <dd className={`tabular text-right ${r.strong ? "font-semibold text-fg" : "text-muted"}`}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
