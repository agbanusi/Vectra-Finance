"use client";

import { CheckCircle2, Clock, Layers, Lock, ShieldAlert, Zap, type LucideIcon } from "lucide-react";
import type { Eligibility } from "@/hooks/useEligibility";
import { useStrategyNames } from "@/hooks/useStrategies";
import { config } from "@/lib/config";
import { formatAmount, formatBpsPct, formatDuration, formatShares } from "@/lib/format";
import { isPermissionless, type IndexView } from "@/lib/types";
import { AddressLink } from "../ui/AddressLink";
import { Badge } from "../ui/Badge";
import { Card, CardHeader } from "../ui/Card";

export function RiskDetails({ index: v, symbol, eligibility }: { index: IndexView; symbol: string; eligibility: Eligibility }) {
  return (
    <div className="space-y-6">
      <Mechanics index={v} />
      <Compliance index={v} eligibility={eligibility} />
      <Parameters index={v} symbol={symbol} />
      <Risks index={v} />
      <Contracts index={v} />
    </div>
  );
}

function Step({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border-strong bg-surface-2 text-accent-strong"><Icon className="size-4" aria-hidden="true" /></span>
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{children}</p>
      </div>
    </li>
  );
}

function Mechanics({ index: v }: { index: IndexView }) {
  return (
    <Card>
      <CardHeader title="How withdrawals work" />
      <ol className="grid gap-5 p-5 sm:p-6 md:grid-cols-2">
        <Step icon={Zap} title="Instant from the buffer">If free liquidity (the {formatBpsPct(v.liquidBufferBps)} target buffer, minus assets reserved for the queue) covers your claim, you are paid in the same transaction.</Step>
        <Step icon={Clock} title="Otherwise, a fair FIFO queue">Larger claims opt in to the queue: shares are escrowed and requests are filled first-in, first-out as keepers withdraw from strategies.</Step>
        <Step icon={ShieldAlert} title="Paid at fill-time NAV, with a floor">Queued requests settle at the NAV when filled, never below your minimum. A request whose floor is not met is skipped until NAV recovers, while later requests proceed.</Step>
        <Step icon={Layers} title={v.partialFillsEnabled ? "Partial fills enabled" : "Fill in full"}>
          {v.partialFillsEnabled ? "Requests can be filled in parts; your floor scales down proportionally with each partial payment." : "Requests are paid in full or not at all."} Unfilled requests expire after {formatDuration(v.redemptionTtl)} and return your shares; you can cancel at any time.
        </Step>
      </ol>
    </Card>
  );
}

function Compliance({ index: v, eligibility }: { index: IndexView; eligibility: Eligibility }) {
  const open = isPermissionless(v.compliancePolicy);
  const tone = eligibility.eligible === true ? "success" : eligibility.eligible === false ? "danger" : "neutral";
  return (
    <Card>
      <CardHeader title="Compliance" action={open ? <Badge tone="info">Permissionless</Badge> : <Badge tone="warning" icon={<Lock />}>Restricted · {v.compliancePolicy}</Badge>} />
      <div className="space-y-3 p-5 pt-3 text-sm sm:p-6 sm:pt-3">
        <p className="leading-relaxed text-muted">
          {open
            ? "Any wallet can deposit, withdraw and transfer this index token."
            : `This index enforces the "${v.compliancePolicy}" policy on every deposit, withdrawal and transfer. Eligibility is attested on-chain by the compliance provider.`}
        </p>
        {open ? null : <p className="flex flex-wrap items-center gap-1.5 text-muted">Compliance module <AddressLink address={v.complianceModule} /></p>}
        <Badge tone={tone} dot>{eligibility.label}</Badge>
      </div>
    </Card>
  );
}

function Parameters({ index: v, symbol }: { index: IndexView; symbol: string }) {
  const d = v.baseDecimals;
  const rows: [string, string][] = [
    ["Target liquidity buffer", formatBpsPct(v.liquidBufferBps)],
    ["Rebalance tolerance", `±${formatBpsPct(v.weightToleranceBps)}`],
    ["Management fee", `${formatBpsPct(v.managementFeeBps)} / year`],
    ["Performance fee", `${formatBpsPct(v.performanceFeeBps)} above high-water mark`],
    ["Minimum deposit", `${formatAmount(v.minDeposit, d, 4)} ${symbol}`],
    ["Minimum withdrawal", `${formatShares(v.minRedeem)} ${v.symbol}`],
    ["Request time-to-live", formatDuration(v.redemptionTtl)],
    ["Queue capacity", `${v.pendingRequests} / ${v.maxQueueLength}`],
    ["Reserved for queue", `${formatAmount(v.reservedAssets, d, 2)} ${symbol}`],
    ["Partial fills", v.partialFillsEnabled ? "Enabled" : "Disabled"],
    ["Config version", v.configVersion.toString()],
  ];
  return (
    <Card>
      <CardHeader title="Parameters" description="Current on-chain configuration." />
      <dl className="grid gap-x-8 p-5 pt-3 sm:grid-cols-2 sm:p-6 sm:pt-3">
        {rows.map(([k, val]) => (
          <div key={k} className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-[13px]">
            <dt className="text-subtle">{k}</dt>
            <dd className="tabular text-right text-fg">{val}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Risks({ index: v }: { index: IndexView }) {
  const items = [
    "Smart-contract risk in Vectra and in every underlying strategy vault; an exploit can reduce NAV.",
    "Liquidity risk: large withdrawals may wait in the queue while keepers unwind positions.",
    "The guardian can pause deposits or withdrawals, or trigger an emergency shutdown that permanently disables deposits (withdrawals continue).",
    "Strategies are limited to governance-approved adapters and targets; curation cannot route funds elsewhere.",
    ...(v.adapters.some((a) => a.quarantined) ? ["At least one strategy is quarantined and excluded from NAV."] : []),
    ...(config.isTestnet ? ["Testnet: assets are test tokens and strategy yields are emulated by testnet vaults."] : []),
  ];
  return (
    <Card>
      <CardHeader title="Risks" />
      <ul className="space-y-2.5 p-5 pt-3 sm:p-6 sm:pt-3">
        {items.map((t) => (
          <li key={t} className="flex gap-2.5 text-[13px] leading-relaxed text-muted">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
            {t}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Contracts({ index: v }: { index: IndexView }) {
  const { names } = useStrategyNames(v.adapters.map((a) => a.target));
  const rows: { label: string; address: string }[] = [
    { label: `${v.symbol} vault & token`, address: v.vault },
    { label: "Base asset", address: v.baseAsset },
    { label: "Curator", address: v.curator },
    ...(isPermissionless(v.compliancePolicy) ? [] : [{ label: "Compliance module", address: v.complianceModule }]),
    ...(config.lens ? [{ label: "Index lens", address: config.lens }] : []),
    ...(config.factory ? [{ label: "Index factory", address: config.factory }] : []),
    ...(config.registry ? [{ label: "Adapter registry", address: config.registry }] : []),
    ...v.adapters.flatMap((a) => [
      { label: names[a.target.toLowerCase()]?.name ?? "Strategy vault", address: a.target },
      { label: `Adapter · ${names[a.target.toLowerCase()]?.symbol ?? "strategy"}`, address: a.adapter },
    ]),
  ];
  return (
    <Card>
      <CardHeader title="Contracts" description="Verify everything on the block explorer." />
      <ul className="divide-y divide-border p-5 pt-2 sm:p-6 sm:pt-2">
        {rows.map((r) => (
          <li key={`${r.label}-${r.address}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]">
            <span className="text-muted">{r.label}</span>
            <AddressLink address={r.address} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
