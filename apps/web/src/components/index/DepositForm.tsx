"use client";

import { Check, Wallet } from "lucide-react";
import { checkDeposit } from "@/lib/deposit";
import { formatAmount, formatBpsPct, formatShares, formatValueCompact, isUsdLike } from "@/lib/format";
import { isTxBusy, TX_PHASE_LABEL, type TxState } from "@/lib/tx";
import { Button } from "../ui/Button";
import { Notice } from "../ui/States";
import { AssetIcon } from "../ui/TokenIcon";
import { cn } from "../ui/cn";
import { AmountInput, TokenChip } from "./AmountInput";
import { SummaryRows } from "./SummaryRows";
import { TxNote } from "./TxNote";

export interface DepositFormProps {
  symbol: string;
  indexSymbol: string;
  decimals: number;
  input: string;
  amount: bigint | null;
  balance: bigint;
  allowance: bigint;
  minDeposit: bigint;
  connected: boolean;
  blockedReason: string | null;
  expectedShares: bigint | undefined;
  minShares: bigint | undefined;
  pricePerShare: bigint;
  managementFeeBps: number;
  performanceFeeBps: number;
  approveTx: TxState;
  depositTx: TxState;
  onInput: (v: string) => void;
  onMax: () => void;
  onApprove: () => void;
  onDeposit: () => void;
  onConnect: () => void;
}

/** Stateless deposit form. All chain I/O lives in DepositPanel. */
export function DepositForm(p: DepositFormProps) {
  const check = checkDeposit({ amount: p.amount, balance: p.balance, allowance: p.allowance, minDeposit: p.minDeposit, blockedReason: p.connected ? p.blockedReason : null });
  const inputError = check.ok || (p.connected && p.blockedReason) ? null : check.message;
  const needsApproval = check.ok && check.needsApproval;
  const usd = isUsdLike(p.symbol);
  const busy = isTxBusy(p.approveTx.phase) || isTxBusy(p.depositTx.phase);

  return (
    <div className="space-y-4">
      <AmountInput
        label="You deposit"
        value={p.input}
        onChange={p.onInput}
        token={<TokenChip icon={<AssetIcon symbol={p.symbol} size={24} />} symbol={p.symbol} />}
        balance={p.connected ? <>Balance {formatAmount(p.balance, p.decimals, 2)}</> : null}
        onMax={p.connected && p.balance > 0n ? p.onMax : undefined}
        usdValue={p.amount && usd ? `≈ ${formatValueCompact(p.amount, p.decimals, p.symbol)}` : null}
        error={inputError}
      />

      <SummaryRows
        rows={[
          { label: "You receive", value: p.expectedShares === undefined ? "—" : `${formatShares(p.expectedShares)} ${p.indexSymbol}`, strong: true },
          { label: "Minimum received", value: p.minShares === undefined ? "—" : `${formatShares(p.minShares)} ${p.indexSymbol}`, info: "Your transaction reverts if fewer index tokens would be minted (slippage protection)." },
          { label: "Rate", value: `1 ${p.indexSymbol} = ${formatAmount(p.pricePerShare, p.decimals, 6)} ${p.symbol}` },
          {
            label: "Fees",
            value: `${formatBpsPct(p.managementFeeBps)}/yr · ${formatBpsPct(p.performanceFeeBps)} perf.`,
            info: "No deposit fee. Management and performance fees accrue as newly minted shares; the quote already reflects fees outstanding now.",
          },
        ]}
      />

      {p.connected && p.blockedReason ? <Notice tone="warning">{p.blockedReason}</Notice> : null}

      {!p.connected ? (
        <Button size="lg" className="w-full" onClick={p.onConnect}>
          <Wallet className="size-4" aria-hidden="true" />
          Connect wallet
        </Button>
      ) : needsApproval ? (
        <div className="space-y-3">
          <Steps current={1} symbol={p.symbol} />
          <Button size="lg" className="w-full" loading={isTxBusy(p.approveTx.phase)} disabled={busy} onClick={p.onApprove}>
            Approve {p.symbol}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {check.ok && p.allowance > 0n && p.approveTx.phase === "confirmed" ? <Steps current={2} symbol={p.symbol} /> : null}
          <Button size="lg" className="w-full" loading={isTxBusy(p.depositTx.phase)} disabled={!check.ok || p.minShares === undefined || busy} onClick={p.onDeposit}>
            {depositLabel(check, p)}
          </Button>
        </div>
      )}
      <TxNote state={needsApproval ? p.approveTx : p.depositTx} />
    </div>
  );
}

function depositLabel(check: ReturnType<typeof checkDeposit>, p: DepositFormProps): string {
  if (isTxBusy(p.depositTx.phase)) return TX_PHASE_LABEL[p.depositTx.phase].replace("…", "");
  if (p.blockedReason) return "Deposit";
  if (!check.ok && p.amount && check.message?.includes("balance")) return "Insufficient balance";
  if (!check.ok && p.amount && check.message?.includes("minimum")) return "Below minimum deposit";
  if (!check.ok && !p.amount) return "Enter an amount";
  return "Deposit";
}

function Steps({ current, symbol }: { current: 1 | 2; symbol: string }) {
  const steps = [`Approve ${symbol}`, "Deposit"];
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="Deposit steps">
      {steps.map((s, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", done ? "bg-success/15 text-success" : active ? "bg-accent text-accent-fg" : "bg-surface-3 text-subtle")}>
              {done ? <Check className="size-3" aria-hidden="true" /> : n}
            </span>
            <span className={active ? "text-fg" : "text-subtle"}>{s}</span>
            {n < steps.length ? <span aria-hidden="true" className="h-px flex-1 bg-border-strong" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
