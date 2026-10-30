"use client";

import { ArrowUpRight, Layers } from "lucide-react";
import Link from "next/link";
import { useMarkets, type Market } from "@/hooks/useMarkets";
import { useTokenSymbol } from "@/hooks/useToken";
import { config } from "@/lib/config";
import { bufferRatio, indexProtocols } from "@/lib/filters";
import { formatPct, formatPricePerShare } from "@/lib/format";
import { bestApy, totalNav } from "@/lib/stats";
import { ApyCell } from "../markets/ApyCell";
import { protocolSlices } from "../markets/Exposure";
import { RestrictedLock } from "../markets/IndexIdentity";
import { AllocationBar } from "../ui/AllocationBar";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState } from "../ui/States";
import { ProtocolStack, TokenIcon } from "../ui/TokenIcon";
import { Value } from "../ui/Value";

function useLanding() {
  const data = useMarkets();
  const symbol = useTokenSymbol(data.markets[0]?.index.baseAsset ?? config.baseAsset ?? undefined);
  const ranked = [...data.markets].sort((a, b) => (a.index.nav === b.index.nav ? 0 : a.index.nav > b.index.nav ? -1 : 1));
  return { ...data, symbol, ranked };
}

export function LiveStats() {
  const { markets, isLoading, apyLoading, symbol } = useLanding();
  const decimals = markets[0]?.index.baseDecimals ?? 6;
  const best = bestApy(markets.map((m) => ({ m, apy: m.apy?.apy ?? null })));
  const items = [
    { label: "Total value locked", value: <Value value={totalNav(markets.map((m) => m.index))} decimals={decimals} symbol={symbol} />, loading: isLoading },
    { label: "Live indexes", value: String(markets.length), loading: isLoading },
    {
      label: "Best realised APY",
      value: best ? <span className="text-success">{formatPct(best.apy)}</span> : "—",
      sub: best ? `${best.m.index.symbol} · ${best.m.apy?.label}` : apyLoading ? undefined : "Awaiting history",
      loading: isLoading || (apyLoading && !best),
    },
  ];
  return (
    <dl className="mt-12 grid max-w-xl grid-cols-3 gap-4 border-t border-white/[0.06] pt-6">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs text-subtle">{it.label}</dt>
          <dd className="tabular mt-1.5 truncate text-xl font-semibold tracking-tight text-fg sm:text-2xl">{it.loading ? <Skeleton className="h-7 w-20" /> : it.value}</dd>
          {it.sub ? <dd className="mt-0.5 truncate text-[11px] text-subtle">{it.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** Floating product card previewing the largest live index. */
export function HeroCard() {
  const { ranked, isLoading, symbol, apyLoading } = useLanding();
  const top = ranked[0];
  return (
    <div className="relative mx-auto w-full max-w-[460px]">
      <div aria-hidden="true" className="absolute -inset-px rounded-[26px] bg-gradient-to-b from-white/15 via-white/[0.04] to-transparent" />
      <div className="relative rounded-[25px] bg-[#0a0e17]/95 p-5 shadow-[0_40px_120px_-30px_rgba(61,107,255,0.45)] backdrop-blur sm:p-6">
        {isLoading || !top ? (
          <div className="space-y-5">
            <div className="flex items-center gap-3"><Skeleton className="size-11 rounded-xl" /><div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-24" /></div></div>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <TokenIcon symbol={top.index.symbol} seed={top.index.vault} size={44} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-fg">{top.index.name}</p>
                  <p className="text-xs text-subtle">{top.index.symbol} · {top.meta.curator}</p>
                </div>
              </div>
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success ring-1 ring-inset ring-success/25">Live</span>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-border bg-surface/60 p-4">
              <div>
                <p className="text-xs text-subtle">Realised APY</p>
                <div className="mt-1"><ApyCell apy={top.apy} loading={apyLoading} align="left" size="lg" /></div>
              </div>
              <div>
                <p className="text-xs text-subtle">TVL</p>
                <p className="mt-1 text-xl font-semibold text-fg"><Value value={top.index.nav} decimals={top.index.baseDecimals} symbol={symbol} /></p>
                <p className="text-[11px] text-subtle">{formatPricePerShare(top.index.pricePerShare, top.index.baseDecimals).slice(0, 8)} per share</p>
              </div>
            </div>
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-subtle">Live allocation</span>
                <ProtocolStack protocols={indexProtocols(top.index)} size={20} />
              </div>
              <AllocationBar slices={protocolSlices(top.index)} height={8} />
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                {protocolSlices(top.index).map((s) => (
                  <li key={s.key} className="flex items-center gap-2 text-xs">
                    <span aria-hidden="true" className="size-2 rounded-sm" style={{ background: s.color }} />
                    <span className="text-muted">{s.label}</span>
                    <span className="tabular ml-auto text-fg">{formatPct(s.weight)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-5 flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-3 text-xs">
              <span className="text-subtle">Instant liquidity</span>
              <span className="tabular font-medium text-fg"><Value value={top.index.availableLiquidity} decimals={top.index.baseDecimals} symbol={symbol} /> <span className="text-subtle">· {formatPct(bufferRatio(top.index))} of NAV</span></span>
            </div>
            <Link href={`/app/index/${top.index.vault}`} className="mt-4 flex h-11 items-center justify-center gap-1.5 rounded-xl bg-fg text-sm font-semibold text-bg transition-colors hover:bg-white">
              Deposit into {top.index.symbol}
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function FeaturedCard({ m, symbol, apyLoading }: { m: Market; symbol: string; apyLoading: boolean }) {
  const v = m.index;
  return (
    <Link href={`/app/index/${v.vault}`} className="surface-card group flex flex-col rounded-[var(--radius-xl)] p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenIcon symbol={v.symbol} seed={v.vault} size={40} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold text-fg">{v.name}{v.compliancePolicy !== "permissionless" ? <RestrictedLock /> : null}</p>
            <p className="truncate text-xs text-subtle">{v.symbol} · {m.meta.curator}</p>
          </div>
        </div>
        <ArrowUpRight className="size-4 shrink-0 text-subtle transition-colors group-hover:text-fg" aria-hidden="true" />
      </div>
      <p className="mt-4 line-clamp-2 min-h-[40px] text-[13px] leading-5 text-muted">{m.meta.description}</p>
      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
        <div>
          <p className="text-xs text-subtle">Realised APY</p>
          <div className="mt-1"><ApyCell apy={m.apy} loading={apyLoading} align="left" /></div>
        </div>
        <div>
          <p className="text-xs text-subtle">TVL</p>
          <p className="mt-1 text-sm font-semibold text-fg"><Value value={v.nav} decimals={v.baseDecimals} symbol={symbol} /></p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <ProtocolStack protocols={indexProtocols(v)} size={20} />
        <AllocationBar slices={protocolSlices(v)} height={4} className="flex-1" />
      </div>
    </Link>
  );
}

export function FeaturedIndexes() {
  const { ranked, isLoading, symbol, apyLoading, configured } = useLanding();
  if (isLoading) {
    return <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[248px] w-full rounded-2xl" />)}</div>;
  }
  if (!configured || ranked.length === 0) {
    return <div className="surface-card rounded-[var(--radius-xl)]"><EmptyState icon={Layers} title="No live indexes on this network yet">Indexes appear here as soon as they are created on-chain.</EmptyState></div>;
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {ranked.slice(0, 6).map((m) => <FeaturedCard key={m.index.vault} m={m} symbol={symbol} apyLoading={apyLoading} />)}
    </div>
  );
}
