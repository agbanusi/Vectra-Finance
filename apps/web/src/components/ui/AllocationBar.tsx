import { cn } from "./cn";

export interface AllocationSlice {
  key: string;
  label: string;
  weight: number;
  color: string;
}

/** Thin stacked bar of weights (fractions summing to ≤ 1). */
export function AllocationBar({ slices, className, height = 6 }: { slices: readonly AllocationSlice[]; className?: string; height?: number }) {
  const total = slices.reduce((a, s) => a + Math.max(0, s.weight), 0) || 1;
  return (
    <div role="img" aria-label={slices.map((s) => `${s.label} ${(s.weight * 100).toFixed(0)}%`).join(", ")} className={cn("flex w-full gap-[2px] overflow-hidden rounded-full bg-surface-3", className)} style={{ height }}>
      {slices.filter((s) => s.weight > 0).map((s) => (
        <span key={s.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(s.weight / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}
