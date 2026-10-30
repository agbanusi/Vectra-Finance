"use client";

import { isOpenRequest, REQUEST_STATUS_LABEL, RequestStatus } from "@vectra/sdk";
import { Check, Clock, Inbox, X } from "lucide-react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { simulateContract } from "wagmi/actions";
import type { RequestRow } from "@/hooks/useRequests";
import { useTx } from "@/hooks/useTx";
import { vaultAbi } from "@/lib/abis";
import { formatAmount, formatDuration, formatShares, formatTimestamp } from "@/lib/format";
import { writeWithGasBuffer } from "@/lib/gas";
import { wagmiConfig } from "@/lib/wagmi";
import { Badge, type Tone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/States";
import { cn } from "../ui/cn";
import { TxNote } from "./TxNote";

export const STATUS_TONE: Record<RequestStatus, Tone> = {
  [RequestStatus.None]: "neutral",
  [RequestStatus.Pending]: "warning",
  [RequestStatus.PartiallyFilled]: "info",
  [RequestStatus.Fulfilled]: "success",
  [RequestStatus.Cancelled]: "neutral",
  [RequestStatus.Expired]: "neutral",
};

type StepState = "done" | "active" | "todo" | "stopped";

/** Timeline steps for a request: Requested → In queue / Partially filled → Filled (or Cancelled / Expired). */
export function requestSteps(status: RequestStatus): { label: string; state: StepState }[] {
  const closedEarly = status === RequestStatus.Cancelled || status === RequestStatus.Expired;
  return [
    { label: "Requested", state: "done" },
    {
      label: status === RequestStatus.PartiallyFilled ? "Partially filled" : "In queue",
      state: isOpenRequest(status) ? "active" : "done",
    },
    {
      label: closedEarly ? REQUEST_STATUS_LABEL[status] : "Filled",
      state: status === RequestStatus.Fulfilled ? "done" : closedEarly ? "stopped" : "todo",
    },
  ];
}

interface Props {
  vault: Address;
  rows: readonly RequestRow[];
  decimals: number;
  symbol: string;
  indexSymbol: string;
  title?: string;
  emptyText?: string;
}

export function RequestsList({ vault, rows, decimals, symbol, indexSymbol, emptyText = "No withdrawal requests" }: Props) {
  const tx = useTx({ label: "Update withdrawal request" });
  const { address } = useAccount();
  if (rows.length === 0) return <EmptyState icon={Inbox} title={emptyText}>Queued withdrawals appear here with their live status.</EmptyState>;
  const now = BigInt(Math.floor(Date.now() / 1000));

  const cancel = (id: bigint) => {
    if (!address) return;
    void tx.execute(
      () => simulateContract(wagmiConfig, { address: vault, abi: vaultAbi, functionName: "cancelRedemption", args: [id, address], account: address }),
      ({ request }) => writeWithGasBuffer(request),
    );
  };
  const expire = (id: bigint) => {
    if (!address) return;
    void tx.execute(
      () => simulateContract(wagmiConfig, { address: vault, abi: vaultAbi, functionName: "expireRedemption", args: [id], account: address }),
      ({ request }) => writeWithGasBuffer(request),
    );
  };

  return (
    <div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const status = r.status as RequestStatus;
          const open = isOpenRequest(status);
          const mine = address?.toLowerCase() === r.owner.toLowerCase();
          const expired = now > r.expiresAt;
          return (
            <li key={r.id.toString()} className="px-5 py-4 sm:px-6" data-testid="request-row">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="tabular text-sm font-semibold text-fg">#{r.id.toString()}</span>
                  <Badge tone={STATUS_TONE[status]} dot>{REQUEST_STATUS_LABEL[status]}</Badge>
                  <span className="text-xs text-subtle">{formatTimestamp(r.requestedAt)}</span>
                </div>
                <div className="flex gap-2">
                  {open && mine ? <Button size="xs" variant="secondary" disabled={tx.busy} onClick={() => cancel(r.id)}>Cancel</Button> : null}
                  {open && expired ? <Button size="xs" variant="ghost" disabled={tx.busy} onClick={() => expire(r.id)}>Expire</Button> : null}
                </div>
              </div>
              <Timeline status={status} />
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <Item label="Shares in queue" value={`${formatShares(r.shares, 4)} ${indexSymbol}`} />
                <Item label="Paid so far" value={`${formatAmount(r.assetsPaid, decimals, 2)} ${symbol}`} />
                <Item label="Floor" value={`${formatAmount(r.minAssetsOut, decimals, 2)} ${symbol}`} />
                <Item label={open ? (expired ? "Expired" : "Expires in") : "Expiry"} value={open && !expired ? formatDuration(r.expiresAt - now) : formatTimestamp(r.expiresAt)} />
              </dl>
            </li>
          );
        })}
      </ul>
      <div className="px-5 pb-3 sm:px-6"><TxNote state={tx.state} /></div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-subtle">{label}</dt>
      <dd className="tabular mt-0.5 truncate text-fg">{value}</dd>
    </div>
  );
}

function Timeline({ status }: { status: RequestStatus }) {
  const steps = requestSteps(status);
  return (
    <ol className="mt-3.5 flex items-center" aria-label="Request progress">
      {steps.map((s, i) => (
        <li key={s.label} className="flex flex-1 items-center last:flex-none">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full ring-1 ring-inset",
                s.state === "done" && "bg-success/15 text-success ring-success/30",
                s.state === "active" && "bg-warning/15 text-warning ring-warning/30",
                s.state === "todo" && "bg-surface-3 text-subtle ring-border-strong",
                s.state === "stopped" && "bg-surface-3 text-muted ring-border-strong",
              )}
            >
              {s.state === "done" ? <Check className="size-3" aria-hidden="true" /> : s.state === "active" ? <Clock className="size-3" aria-hidden="true" /> : s.state === "stopped" ? <X className="size-3" aria-hidden="true" /> : <span className="size-1.5 rounded-full bg-current" />}
            </span>
            <span className={cn("whitespace-nowrap text-xs", s.state === "todo" ? "text-subtle" : "text-fg")}>{s.label}</span>
          </span>
          {i < steps.length - 1 ? <span aria-hidden="true" className={cn("mx-3 h-px flex-1", s.state === "done" && steps[i + 1]?.state !== "todo" ? "bg-success/40" : "bg-border-strong")} /> : null}
        </li>
      ))}
    </ol>
  );
}
