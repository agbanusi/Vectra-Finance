import type { RedemptionEstimate } from "@vectra/sdk";
import { Clock, Zap, Ban } from "lucide-react";
import { formatAmount } from "@/lib/format";
import { Badge } from "../ui/Badge";

interface Props {
  estimate: RedemptionEstimate;
  decimals: number;
  symbol: string;
  minAssetsOut: bigint;
}

/** Explains clearly whether a withdrawal pays now, must queue, or cannot proceed. */
export function RedemptionEstimateView({ estimate: e, decimals, symbol, minAssetsOut }: Props) {
  const fmt = (x: bigint) => `${formatAmount(x, decimals, 4)} ${symbol}`;
  if (e.mode === "unavailable") {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/[0.06] p-3.5 text-[13px]" data-mode="unavailable">
        <Badge tone="danger" icon={<Ban />}>Unavailable</Badge>
        <p className="mt-2 text-fg">{e.reason ?? "Withdrawal is not possible right now."}</p>
      </div>
    );
  }
  if (e.mode === "instant") {
    return (
      <div className="rounded-xl border border-success/25 bg-success/[0.05] p-3.5 text-[13px]" data-mode="instant">
        <Badge tone="success" icon={<Zap />}>Instant</Badge>
        <p className="mt-2 text-fg">Paid now from the liquidity buffer in a single transaction.</p>
        <p className="mt-1 text-muted">Free liquidity {fmt(e.availableLiquidity)} covers your claim. Minimum accepted: {fmt(minAssetsOut)}.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/[0.06] p-3.5 text-[13px]" data-mode="queued">
      <Badge tone="warning" icon={<Clock />}>Queued — not instant</Badge>
      <p className="mt-2 text-fg">
        Your claim (~{fmt(e.expectedAssets)}) exceeds free liquidity ({fmt(e.availableLiquidity)}) by {fmt(e.shortfall)}.
      </p>
      <ul className="mt-2 space-y-1.5 text-muted">
        <li className="flex gap-2"><Dot />Shares are escrowed and join a first-in, first-out queue.</li>
        <li className="flex gap-2"><Dot />Filled as keepers withdraw from underlying vaults, paid at NAV at fill time — not today&apos;s quote.</li>
        <li className="flex gap-2"><Dot />Never less than your floor of {fmt(minAssetsOut)}; if NAV dips below it, your request is skipped until it recovers.</li>
        <li className="flex gap-2"><Dot />Cancel any time. Unfilled requests expire and return your shares.</li>
      </ul>
    </div>
  );
}

function Dot() {
  return <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-warning/70" />;
}
