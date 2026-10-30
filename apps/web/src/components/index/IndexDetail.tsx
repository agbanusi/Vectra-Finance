"use client";

import { SearchX } from "lucide-react";
import Link from "next/link";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { useIndexActivity } from "@/hooks/useActivity";
import { useIndexApys } from "@/hooks/useApy";
import { useEligibility } from "@/hooks/useEligibility";
import { useIndex } from "@/hooks/useIndexes";
import { useIndexMeta } from "@/hooks/useMarkets";
import { useMounted } from "@/hooks/useMounted";
import { ownedBy, useRequests } from "@/hooks/useRequests";
import { useTokenSymbol } from "@/hooks/useToken";
import { useUserPosition } from "@/hooks/useUser";
import { bufferRatio } from "@/lib/filters";
import { formatBpsPct, formatCompact, formatPct, formatPricePerShare, formatShares, formatValueCompact, toNumber } from "@/lib/format";
import type { IndexMetadata } from "@/lib/metadata";
import type { IndexView } from "@/lib/types";
import { ApyCell, apyTooltip } from "../markets/ApyCell";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Kpi } from "../ui/Kpi";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, Notice } from "../ui/States";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";
import { Value } from "../ui/Value";
import { ActionCard } from "./ActionCard";
import { ActivityList } from "./ActivityList";
import { AllocationSection } from "./AllocationSection";
import { IndexHeader } from "./IndexHeader";
import { PerformanceChart } from "./PerformanceChart";
import { RequestsList } from "./RequestsList";
import { RiskDetails } from "./RiskDetails";

export function IndexDetail({ address }: { address: Address }) {
  const { data, isLoading, error } = useIndex(address);
  if (isLoading) return <DetailSkeleton />;
  if (error || !data || data.vault === "0x0000000000000000000000000000000000000000") {
    return (
      <Card>
        <EmptyState icon={SearchX} title="Index not found" action={<Link href="/app"><Button size="sm" variant="secondary">Back to markets</Button></Link>}>
          {error ? error.message.split("\n")[0] : "This address is not a Vectra index on this network."}
        </EmptyState>
      </Card>
    );
  }
  return <Loaded index={data} />;
}

function Loaded({ index: v }: { index: IndexView }) {
  const meta = useIndexMeta(v) as IndexMetadata;
  const symbol = useTokenSymbol(v.baseAsset);
  const eligibility = useEligibility(v.compliancePolicy, v.complianceModule);
  return (
    <div className="space-y-8">
      <IndexHeader index={v} meta={meta} />
      <KpiStrip index={v} symbol={symbol} />
      {v.navHealthy ? null : <Notice tone="warning" title="Valuation degraded">A strategy&apos;s valuation is currently failing, so NAV may be understated until it recovers.</Notice>}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <div className="order-2 min-w-0 lg:order-1">
          <Tabs defaultValue="overview">
            <TabsList aria-label="Index sections">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="risk">Risk &amp; details</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-6 space-y-6 focus-visible:outline-none">
              <PerformanceChart vault={v.vault} baseDecimals={v.baseDecimals} symbol={symbol} indexSymbol={v.symbol} />
              <AllocationSection index={v} symbol={symbol} />
              <About meta={meta} />
            </TabsContent>
            <TabsContent value="activity" className="mt-6 focus-visible:outline-none">
              <IndexActivity index={v} symbol={symbol} />
            </TabsContent>
            <TabsContent value="risk" className="mt-6 focus-visible:outline-none">
              <RiskDetails index={v} symbol={symbol} eligibility={eligibility} />
            </TabsContent>
          </Tabs>
        </div>
        <aside className="order-1 min-w-0 space-y-4 lg:sticky lg:top-24 lg:order-2" aria-label="Deposit and withdraw">
          <ActionCard index={v} symbol={symbol} eligibility={eligibility} />
          <PositionCard index={v} symbol={symbol} />
        </aside>
      </div>
      <MyRequests index={v} symbol={symbol} />
    </div>
  );
}

function KpiStrip({ index: v, symbol }: { index: IndexView; symbol: string }) {
  const apys = useIndexApys([{ vault: v.vault, baseDecimals: v.baseDecimals }]);
  const apy = apys.data?.[v.vault] ?? null;
  return (
    <dl className="surface-card grid grid-cols-2 gap-x-4 gap-y-5 rounded-[var(--radius-xl)] p-5 sm:grid-cols-3 sm:p-6 xl:grid-cols-6">
      <Kpi label="Total value locked" value={<Value value={v.nav} decimals={v.baseDecimals} symbol={symbol} />} sub={`${formatCompact(toNumber(v.totalSupply, 18))} shares outstanding`} />
      <Kpi label="Realised APY" value={<ApyCell apy={apy} loading={apys.isLoading} align="left" size="lg" />} info={apyTooltip(apy)} />
      <Kpi label="Price per share" value={formatPricePerShare(v.pricePerShare, v.baseDecimals)} sub={symbol} />
      <Kpi label="Instant liquidity" value={<Value value={v.availableLiquidity} decimals={v.baseDecimals} symbol={symbol} />} sub={`${formatPct(bufferRatio(v))} of NAV · target ${formatBpsPct(v.liquidBufferBps)}`} info="Free liquidity available for instant withdrawals: the buffer minus assets reserved for queued requests." />
      <Kpi label="Queue depth" value={`${v.pendingRequests}`} sub={`${formatValueCompact(v.reservedAssets, v.baseDecimals, symbol)} reserved · max ${v.maxQueueLength}`} info="Open withdrawal requests waiting in the FIFO queue." />
      <Kpi label="Fees" value={`${formatBpsPct(v.managementFeeBps)}`} sub={`mgmt/yr · ${formatBpsPct(v.performanceFeeBps)} performance`} info="No deposit or withdrawal fees. Management fee accrues continuously; performance fee only above the high-water mark. Both are minted as shares." />
    </dl>
  );
}

function About({ meta }: { meta: IndexMetadata }) {
  if (!meta.description) return null;
  return (
    <Card>
      <CardHeader title="About this index" />
      <div className="space-y-4 p-5 pt-3 sm:p-6 sm:pt-3">
        <p className="text-sm leading-relaxed text-muted">{meta.description}</p>
        {meta.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">{meta.tags.map((t) => <span key={t} className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs text-muted">{t}</span>)}</div>
        ) : null}
        <p className="text-xs leading-relaxed text-subtle">
          Strategy labels describe an allocation style. On testnet, underlying vaults are emulations; Vectra is not affiliated with or endorsed by any named team.
        </p>
      </div>
    </Card>
  );
}

function PositionCard({ index: v, symbol }: { index: IndexView; symbol: string }) {
  const mounted = useMounted();
  const { address } = useAccount();
  const { data, isLoading } = useUserPosition(v.vault);
  const { rows } = useRequests(v.vault, v.nextRequestId);
  if (!mounted || !address) return null;
  const queuedShares = ownedBy(rows, address).filter((r) => r.status === 1 || r.status === 2).reduce((s, r) => s + r.shares, 0n);
  return (
    <Card className="p-5">
      <p className="text-xs font-medium text-subtle">Your position</p>
      <dl className="mt-3 grid grid-cols-2 gap-4">
        <Kpi size="sm" label="Value" value={data ? <Value value={data.value} decimals={v.baseDecimals} symbol={symbol} /> : "—"} loading={isLoading} sub="At current NAV" />
        <Kpi size="sm" label="Shares" value={data ? formatShares(data.shares, 4) : "—"} loading={isLoading} sub={v.symbol} />
      </dl>
      {queuedShares > 0n ? <p className="mt-3 rounded-lg bg-warning/[0.07] px-3 py-2 text-xs text-warning">{formatShares(queuedShares, 4)} {v.symbol} escrowed in the withdrawal queue</p> : null}
    </Card>
  );
}

function MyRequests({ index: v, symbol }: { index: IndexView; symbol: string }) {
  const mounted = useMounted();
  const { address } = useAccount();
  const { rows } = useRequests(v.vault, v.nextRequestId);
  if (!mounted || !address) return null;
  const mine = ownedBy(rows, address);
  if (mine.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Your withdrawal requests" description="Cancel open requests any time. Anyone can expire a request after its deadline; escrowed shares return to you." />
      <div className="mt-3 border-t border-border">
        <RequestsList vault={v.vault} rows={mine} decimals={v.baseDecimals} symbol={symbol} indexSymbol={v.symbol} />
      </div>
    </Card>
  );
}

function IndexActivity({ index: v, symbol }: { index: IndexView; symbol: string }) {
  const q = useIndexActivity(v.vault);
  return (
    <Card>
      <CardHeader title="Recent activity" description="Deposits, withdrawals and queue fills across all wallets." />
      <div className="mt-3 border-t border-border">
        <ActivityList query={q} decimals={v.baseDecimals} symbol={symbol} emptyText="No recent activity" />
      </div>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="flex items-center gap-4"><Skeleton className="size-14 rounded-2xl" /><div className="space-y-2.5"><Skeleton className="h-7 w-72" /><Skeleton className="h-5 w-56" /></div></div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]"><Skeleton className="h-[380px] w-full rounded-2xl" /><Skeleton className="h-[460px] w-full rounded-2xl" /></div>
    </div>
  );
}

