"use client";

import { Layers, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { MarketFilters } from "@/components/markets/MarketFilters";
import { MarketsTable } from "@/components/markets/MarketsTable";
import { StatStrip } from "@/components/markets/StatStrip";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Value } from "@/components/ui/Value";
import { useMarkets, type Market } from "@/hooks/useMarkets";
import { useMounted } from "@/hooks/useMounted";
import { useTokenSymbol } from "@/hooks/useToken";
import { useUserPositions } from "@/hooks/useUser";
import { config } from "@/lib/config";
import { DEFAULT_FILTERS, filterMarkets, sortMarkets, uniqueSorted, type MarketRow, type SortDir, type SortKey } from "@/lib/filters";
import { formatPct } from "@/lib/format";
import { weightedApy, totalNav } from "@/lib/stats";

export default function MarketsPage() {
  const { markets, isLoading, error, configured, apyLoading } = useMarkets();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "tvl", dir: "desc" });
  const symbol = useTokenSymbol(markets[0]?.index.baseAsset ?? config.baseAsset ?? undefined);

  const rows = useMemo<(MarketRow & { market: Market })[]>(
    () => markets.map((m) => ({ index: m.index, curator: m.meta.curator, category: m.meta.category, apy: m.apy?.apy ?? null, market: m })),
    [markets],
  );
  const visible = useMemo(() => sortMarkets(filterMarkets(rows, filters), sort.key, sort.dir).map((r) => (r as (typeof rows)[number]).market), [rows, filters, sort]);
  const curators = useMemo(() => uniqueSorted(rows.map((r) => r.curator)), [rows]);
  const categories = useMemo(() => uniqueSorted(rows.map((r) => r.category)), [rows]);

  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "name" ? "asc" : "desc" }));

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[28px] font-semibold tracking-tight text-fg sm:text-[32px]">Markets</h1>
        <p className="max-w-2xl text-[15px] text-muted">Diversified USDC index tokens. Every figure is read live from chain; APY is realised, never projected.</p>
      </header>
      <Stats markets={markets} symbol={symbol} loading={isLoading} apyLoading={apyLoading} />
      <section aria-labelledby="indexes-heading" className="space-y-4">
        <h2 id="indexes-heading" className="sr-only">Indexes</h2>
        <MarketFilters filters={filters} curators={curators} categories={categories} onChange={setFilters} />
        {!configured ? (
          <ErrorState title="App not configured for this network" detail="Set NEXT_PUBLIC_FACTORY and NEXT_PUBLIC_LENS, or add a bundled deployment for this chain." />
        ) : error ? (
          <ErrorState title="Could not load indexes from chain" detail={error.message.split("\n")[0]} />
        ) : isLoading ? (
          <TableSkeleton />
        ) : markets.length === 0 ? (
          <div className="surface-card rounded-[var(--radius-xl)]"><EmptyState icon={Layers} title="No indexes yet">Indexes created through the factory appear here automatically.</EmptyState></div>
        ) : visible.length === 0 ? (
          <div className="surface-card rounded-[var(--radius-xl)]">
            <EmptyState icon={SearchX} title="No indexes match these filters" action={<Button size="sm" variant="secondary" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</Button>} />
          </div>
        ) : (
          <MarketsTable markets={visible} symbol={symbol} sort={sort} onSort={onSort} apyLoading={apyLoading} />
        )}
      </section>
    </div>
  );
}

function Stats({ markets, symbol, loading, apyLoading }: { markets: readonly Market[]; symbol: string; loading: boolean; apyLoading: boolean }) {
  const mounted = useMounted();
  const { address } = useAccount();
  const positions = useUserPositions(markets.map((m) => m.index.vault));
  const decimals = markets[0]?.index.baseDecimals ?? 6;
  const tvl = totalNav(markets.map((m) => m.index));
  const avg = weightedApy(markets.map((m) => ({ nav: m.index.nav, apy: m.apy?.apy ?? null })));
  const deposits = (positions.data ?? []).reduce((sum, r) => sum + (r.status === "success" ? r.result.value : 0n), 0n);
  const withApy = markets.filter((m) => m.apy).length;
  return (
    <StatStrip
      items={[
        { label: "Total value locked", value: <Value value={tvl} decimals={decimals} symbol={symbol} />, sub: `Across ${markets.length} index${markets.length === 1 ? "" : "es"}`, loading },
        { label: "Indexes", value: markets.length, sub: `${markets.filter((m) => m.index.compliancePolicy !== "permissionless").length} restricted`, loading },
        {
          label: "Avg realised APY",
          value: avg === null ? "—" : formatPct(avg),
          sub: avg === null ? "Awaiting price history" : `TVL-weighted · ${withApy} of ${markets.length} indexes`,
          info: "TVL-weighted average of each index's realised APY (annualised growth of price per share). Historical, not a forecast.",
          loading: loading || (apyLoading && avg === null),
        },
        {
          label: "Your deposits",
          value: mounted && address ? <Value value={deposits} decimals={decimals} symbol={symbol} /> : "—",
          sub: mounted && address ? "At current NAV" : "Connect a wallet",
          loading: Boolean(mounted && address && positions.isLoading),
        },
      ]}
    />
  );
}

function TableSkeleton() {
  return (
    <div className="surface-card space-y-0 divide-y divide-border overflow-hidden rounded-[var(--radius-xl)]">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-9 rounded-xl" />
          <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-48" /><Skeleton className="h-3 w-28" /></div>
          <Skeleton className="hidden h-4 w-20 sm:block" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
