"use client";

import { LineChart } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import type { Address } from "viem";
import { usePerformance, type ChartRange } from "@/hooks/useApy";
import { formatCompact } from "@/lib/format";
import { seriesChange, type SeriesPoint } from "@/lib/history";
import { Card } from "../ui/Card";
import { Segmented } from "../ui/Segmented";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState } from "../ui/States";
import { InfoTip } from "../ui/Tooltip";

type Metric = "pps" | "nav";

const RANGES: { value: ChartRange; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
];

function fmtTime(t: number, spanSeconds: number): string {
  const d = new Date(t * 1000);
  return spanSeconds <= 2 * 86_400
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Enough decimals to distinguish ticks across a (possibly tiny) value range. */
function precisionFor(range: number): number {
  if (!(range > 0)) return 4;
  return Math.min(8, Math.max(2, Math.ceil(-Math.log10(range)) + 1));
}

function fmtChange(change: number): string {
  const pct = change * 100;
  const digits = Math.abs(pct) >= 0.01 || pct === 0 ? 2 : 4;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

function fmtValue(v: number, metric: Metric, symbol: string): string {
  if (metric === "pps") return `${v.toFixed(6)} ${symbol}`;
  return /usd/i.test(symbol) ? `$${formatCompact(v)}` : `${formatCompact(v)} ${symbol}`;
}

export function PerformanceChart({ vault, baseDecimals, symbol, indexSymbol }: { vault: Address; baseDecimals: number; symbol: string; indexSymbol: string }) {
  const [range, setRange] = useState<ChartRange>("7d");
  const [metric, setMetric] = useState<Metric>("pps");
  const { data, isLoading, isError } = usePerformance(vault, baseDecimals, range);
  const series = data?.series ?? [];
  const last = series[series.length - 1];
  const change = seriesChange(series, metric);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-subtle">
            {metric === "pps" ? `Price per ${indexSymbol}` : "Net asset value"}
            <InfoTip>
              {data?.source === "api"
                ? "From the indexer's NAV snapshots."
                : "Sampled from historical on-chain state. Public RPC nodes keep roughly 1.5 days of history, so longer ranges may show only the window the node can serve."}
            </InfoTip>
          </div>
          <div className="mt-1.5 flex items-baseline gap-2.5">
            <span className="tabular text-2xl font-semibold tracking-tight text-fg">{last ? fmtValue(last[metric], metric, symbol) : "—"}</span>
            {change !== null ? <span className={`tabular text-sm font-medium ${change >= 0 ? "text-success" : "text-danger"}`}>{fmtChange(change)}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Metric" value={metric} onChange={setMetric} options={[{ value: "pps", label: "Price" }, { value: "nav", label: "NAV" }]} />
          <Segmented label="Range" value={range} onChange={setRange} options={RANGES} />
        </div>
      </div>
      <div className="px-2 pb-4 pt-4 sm:px-3">
        {isLoading ? (
          <div className="px-3"><Skeleton className="h-[260px] w-full rounded-xl" /></div>
        ) : isError || series.length < 2 ? (
          <EmptyState icon={LineChart} title={isError ? "History unavailable" : "Not enough history yet"} className="h-[260px] justify-center py-0">
            {isError ? "Historical state could not be read from the RPC node. Live figures above come straight from chain." : "The chart fills in as the index accrues on-chain history."}
          </EmptyState>
        ) : (
          <>
            <Chart series={series} metric={metric} symbol={symbol} />
            {data?.truncated ? <p className="px-3 pt-1 text-[11px] text-subtle">Showing the range available from the RPC node (pruned history beyond it).</p> : null}
          </>
        )}
      </div>
    </Card>
  );
}

function Chart({ series, metric, symbol }: { series: readonly SeriesPoint[]; metric: Metric; symbol: string }) {
  const span = (series[series.length - 1]?.t ?? 0) - (series[0]?.t ?? 0);
  const values = series.map((p) => p[metric]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.15 || Math.abs(max) * 0.0005 || 1;
  const first = series[0];
  const last = series[series.length - 1];
  const label = `${metric === "pps" ? "Price per share" : "NAV"} from ${first ? fmtValue(first[metric], metric, symbol) : ""} to ${last ? fmtValue(last[metric], metric, symbol) : ""}`;
  return (
    <div role="img" aria-label={label} className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...series]} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="perf-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5b8cff" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#5b8cff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#1a2130" strokeDasharray="0" />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t: number) => fmtTime(t, span)} tick={{ fill: "#7f899c", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={48} tickMargin={8} />
          <YAxis
            dataKey={metric}
            domain={[min - pad, max + pad]}
            tickFormatter={(v: number) => (metric === "pps" ? v.toFixed(precisionFor(max - min)) : formatCompact(v, 2))}
            tick={{ fill: "#7f899c", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={metric === "pps" ? 24 + 7 * precisionFor(max - min) : 56}
            orientation="right"
          />
          <RTooltip
            cursor={{ stroke: "#3a4458", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as SeriesPoint | undefined;
              if (!active || !p) return null;
              return (
                <div className="rounded-lg border border-border-strong bg-surface-3 px-3 py-2 text-xs shadow-[var(--shadow-pop)]">
                  <p className="text-subtle">{new Date(p.t * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>
                  <p className="tabular mt-1 font-semibold text-fg">{fmtValue(p[metric], metric, symbol)}</p>
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey={metric} stroke="#5b8cff" strokeWidth={2} fill="url(#perf-fill)" isAnimationActive={false} activeDot={{ r: 4, stroke: "#0b0f18", strokeWidth: 2, fill: "#5b8cff" }} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
