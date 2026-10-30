"use client";

import type { RedemptionEstimate } from "@vectra/sdk";
import { Wallet } from "lucide-react";
import { checkRedeem } from "@/lib/redeem";
import { formatAmount, formatShares, formatValueCompact, isUsdLike } from "@/lib/format";
import { isTxBusy, type TxState } from "@/lib/tx";
import { Button } from "../ui/Button";
import { Notice } from "../ui/States";
import { TokenIcon } from "../ui/TokenIcon";
import { AmountInput, TokenChip } from "./AmountInput";
import { RedemptionEstimateView } from "./RedemptionEstimate";
import { SummaryRows } from "./SummaryRows";
import { TxNote } from "./TxNote";

export interface WithdrawFormProps {
  symbol: string;
  indexSymbol: string;
  vault: string;
  decimals: number;
  input: string;
  shares: bigint | null;
  balance: bigint;
  balanceValue: bigint;
  minRedeem: bigint;
  connected: boolean;
  blockedReason: string | null;
  estimate: RedemptionEstimate | undefined;
  minAssetsOut: bigint | undefined;
  allowQueue: boolean;
  tx: TxState;
  onInput: (v: string) => void;
  onMax: () => void;
  onAllowQueue: (v: boolean) => void;
  onWithdraw: () => void;
  onConnect: () => void;
}

export function WithdrawForm(p: WithdrawFormProps) {
  const check = checkRedeem({ shares: p.shares, balance: p.balance, minRedeem: p.minRedeem, blockedReason: p.connected ? p.blockedReason : null });
  const inputError = check.ok || (p.connected && p.blockedReason) ? null : check.message;
  const queued = p.estimate?.mode === "queued";
  const canSubmit = check.ok && p.estimate !== undefined && p.estimate.mode !== "unavailable" && p.minAssetsOut !== undefined && (!queued || p.allowQueue);
  const usd = isUsdLike(p.symbol);

  return (
    <div className="space-y-4">
      <AmountInput
        label="You withdraw"
        value={p.input}
        onChange={p.onInput}
        token={<TokenChip icon={<TokenIcon symbol={p.indexSymbol} seed={p.vault} size={24} />} symbol={p.indexSymbol} />}
        balance={p.connected ? <>Balance {formatShares(p.balance, 4)}</> : null}
        onMax={p.connected && p.balance > 0n ? p.onMax : undefined}
        usdValue={p.estimate && usd ? `≈ ${formatValueCompact(p.estimate.expectedAssets, p.decimals, p.symbol)}` : p.connected && p.balance > 0n && usd ? `Position ≈ ${formatValueCompact(p.balanceValue, p.decimals, p.symbol)}` : null}
        error={inputError}
      />

      <SummaryRows
        rows={[
          { label: "You receive", value: p.estimate && p.shares ? `${formatAmount(p.estimate.expectedAssets, p.decimals, 4)} ${p.symbol}` : "—", strong: true, info: "Quoted at current NAV. Queued withdrawals settle at NAV when filled." },
          { label: queued ? "Floor (minimum paid)" : "Minimum received", value: p.minAssetsOut !== undefined && p.shares ? `${formatAmount(p.minAssetsOut, p.decimals, 4)} ${p.symbol}` : "—", info: "Slippage-protected minimum. For queued requests, this is the floor below which your request will not be paid." },
          { label: "Withdrawal fee", value: "None" },
        ]}
      />

      {p.estimate && p.minAssetsOut !== undefined && p.shares ? <RedemptionEstimateView estimate={p.estimate} decimals={p.decimals} symbol={p.symbol} minAssetsOut={p.minAssetsOut} /> : null}

      {queued ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2 p-3.5 text-[13px]">
          <input type="checkbox" checked={p.allowQueue} onChange={(e) => p.onAllowQueue(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]" />
          <span>
            <span className="font-medium text-fg">Queue my withdrawal</span>
            <span className="mt-0.5 block text-muted">I understand this is not instant and will be paid at fill-time NAV, never below my floor.</span>
          </span>
        </label>
      ) : null}

      {p.connected && p.blockedReason ? <Notice tone="warning">{p.blockedReason}</Notice> : null}

      {!p.connected ? (
        <Button size="lg" className="w-full" onClick={p.onConnect}>
          <Wallet className="size-4" aria-hidden="true" />
          Connect wallet
        </Button>
      ) : (
        <Button size="lg" className="w-full" loading={isTxBusy(p.tx.phase)} disabled={!canSubmit} onClick={p.onWithdraw}>
          {!p.shares ? "Enter an amount" : queued ? "Request withdrawal" : "Withdraw"}
        </Button>
      )}
      <TxNote state={p.tx} />
    </div>
  );
}
