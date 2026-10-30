"use client";

import { cn } from "./cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** Compact radio group (chart ranges, metric toggles). Arrow keys move selection. */
export function Segmented<T extends string>({ options, value, onChange, label, size = "sm" }: { options: readonly SegmentedOption<T>[]; value: T; onChange: (v: T) => void; label: string; size?: "xs" | "sm" }) {
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
    if (next) onChange(next.value);
    const parent = (e.currentTarget as HTMLElement).parentElement;
    const idx = (i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length;
    (parent?.children[idx] as HTMLElement | undefined)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-bg p-0.5 ring-1 ring-inset ring-border">
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md font-medium transition-colors",
              size === "xs" ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-xs",
              active ? "bg-surface-3 text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" : "text-subtle hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
