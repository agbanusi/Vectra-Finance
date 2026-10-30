"use client";

import { useId, type ReactNode } from "react";
import { cn } from "../ui/cn";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  token: ReactNode;
  balance: ReactNode;
  onMax?: () => void;
  usdValue?: ReactNode;
  error?: string | null;
  disabled?: boolean;
}

const AMOUNT_RE = /^\d*\.?\d*$/;

/** Large amount field with token chip, balance and MAX — the core of the action card. */
export function AmountInput({ label, value, onChange, token, balance, onMax, usdValue, error, disabled }: Props) {
  const id = useId();
  return (
    <div
      className={cn(
        "rounded-2xl border bg-bg/60 p-4 transition-colors focus-within:border-accent/60 focus-within:bg-bg",
        error ? "border-danger/50" : "border-border",
        disabled && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between text-xs text-subtle">
        <label htmlFor={id} className="font-medium">{label}</label>
        <span className="tabular flex items-center gap-1.5">
          {balance}
          {onMax ? (
            <button type="button" onClick={onMax} disabled={disabled} className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-strong transition-colors hover:bg-accent/25">
              Max
            </button>
          ) : null}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0.00"
          value={value}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => {
            const next = e.target.value.replace(",", ".");
            if (AMOUNT_RE.test(next)) onChange(next);
          }}
          className="tabular min-w-0 flex-1 bg-transparent text-[30px] font-semibold leading-none tracking-tight text-fg placeholder:text-surface-3 focus:outline-none"
        />
        <div className="shrink-0">{token}</div>
      </div>
      <div className="mt-2 flex min-h-4 items-center justify-between text-xs">
        <span className="tabular text-subtle">{usdValue}</span>
        {error ? <span id={`${id}-err`} role="alert" className="text-danger">{error}</span> : null}
      </div>
    </div>
  );
}

export function TokenChip({ icon, symbol }: { icon: ReactNode; symbol: string }) {
  return (
    <span className="inline-flex h-9 max-w-[150px] items-center gap-2 rounded-full border border-border-strong bg-surface-2 pl-1.5 pr-3 text-sm font-semibold text-fg">
      {icon}
      <span className="truncate">{symbol}</span>
    </span>
  );
}
