"use client";

import { Settings2 } from "lucide-react";
import { useState } from "react";
import { Popover } from "../ui/Popover";
import { cn } from "../ui/cn";

export const DEFAULT_SLIPPAGE_BPS = 50;
const PRESETS = [10, 50, 100];

/** Whole bps in [0, 5000], else null. */
export function parseSlippage(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 5_000 ? n : null;
}

/** Percent text (e.g. "0.5") → bps, else null. */
export function percentToBps(raw: string): number | null {
  if (!/^\d*\.?\d{0,2}$/.test(raw) || raw === "" || raw === ".") return null;
  const bps = Math.round(Number(raw) * 100);
  return bps >= 0 && bps <= 5_000 ? bps : null;
}

export function SlippagePopover({ bps, onChange }: { bps: number; onChange: (bps: number) => void }) {
  const [custom, setCustom] = useState(PRESETS.includes(bps) ? "" : String(bps / 100));
  const invalid = custom !== "" && percentToBps(custom) === null;
  return (
    <Popover
      trigger={
        <button type="button" aria-label={`Slippage tolerance ${(bps / 100).toFixed(2)}%. Change`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg">
          <Settings2 className="size-3.5" aria-hidden="true" />
          <span className="tabular">{(bps / 100).toFixed(2)}%</span>
        </button>
      }
    >
      <p className="text-sm font-medium text-fg">Slippage tolerance</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">Protects you if the share price moves before your transaction is included. Your transaction reverts rather than settle below this bound.</p>
      <div className="mt-3 flex gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={bps === p && custom === ""}
            onClick={() => {
              setCustom("");
              onChange(p);
            }}
            className={cn(
              "tabular h-8 flex-1 rounded-lg text-xs font-medium ring-1 ring-inset transition-colors",
              bps === p && custom === "" ? "bg-accent-soft text-accent-strong ring-accent/40" : "text-muted ring-border hover:text-fg",
            )}
          >
            {(p / 100).toFixed(p < 100 ? 1 : 0)}%
          </button>
        ))}
        <label className="relative flex-1">
          <span className="sr-only">Custom slippage percent</span>
          <input
            inputMode="decimal"
            placeholder="Custom"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              const next = percentToBps(e.target.value);
              if (next !== null) onChange(next);
            }}
            aria-invalid={invalid}
            className={cn("tabular h-8 w-full rounded-lg bg-bg pl-2 pr-5 text-xs text-fg ring-1 ring-inset placeholder:text-subtle focus:outline-none focus:ring-accent/60", invalid ? "ring-danger/60" : "ring-border")}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-subtle">%</span>
        </label>
      </div>
      {invalid ? <p role="alert" className="mt-2 text-xs text-danger">Enter 0–50% with up to 2 decimals.</p> : null}
      {bps > 300 && !invalid ? <p className="mt-2 text-xs text-warning">High tolerance: you may receive noticeably less than quoted.</p> : null}
    </Popover>
  );
}
