"use client";

import { driftBps } from "@vectra/sdk";
import { PieChart as PieIcon } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { useStrategyApys } from "@/hooks/useApy";
import { useStrategyNames } from "@/hooks/useStrategies";
import { protocolLabel } from "@/lib/filters";
import { formatDriftBps, formatPct, formatValueCompact, formatValuePrecise } from "@/lib/format";
import type { AdapterView, IndexView } from "@/lib/types";
import { ApyCell } from "../markets/ApyCell";
import { AddressLink } from "../ui/AddressLink";
import { Badge, type Tone } from "../ui/Badge";
import { Card, CardHeader } from "../ui/Card";
import { EmptyState } from "../ui/States";
import { ProtocolIcon } from "../ui/TokenIcon";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../ui/cn";

/** Fixed-order categorical palette (validated for dark surfaces), assigned by adapter position. */
const CAT = ["var(--color-cat-1)", "var(--color-cat-2)", "var(--color-cat-3)", "var(--color-cat-4)", "var(--color-cat-5)", "var(--color-cat-6)"];
const BUFFER_COLOR = "#3a4458";

export function adapterHealth(a: AdapterView): { tone: Tone; label: string } {
  if (a.quarantined) return { tone: "danger", label: "Quarantined" };
  if (!a.valuationOk) return { tone: "danger", label: "Valuation failing" };
  if (!a.healthy) return { tone: "warning", label: "Unhealthy" };
  if (!a.enabled) return { tone: "neutral", label: "Disabled" };
  return { tone: "success", label: "Healthy" };
}

function share(part: bigint, whole: bigint): number {
  return whole > 0n ? Number((part * 1_000_000n) / whole) / 1_000_000 : 0;
}

export function AllocationSection({ index: v, symbol }: { index: IndexView; symbol: string }) {
  const targets = v.adapters.map((a) => a.target);
  const { names } = useStrategyNames(targets);
  const apys = useStrategyApys(targets);
  if (v.adapters.length === 0) {
    return (
      <Card>
        <CardHeader title="Allocation" />
        <EmptyState icon={PieIcon} title="No strategies configured">This index currently holds only its base asset.</EmptyState>
      </Card>
    );
  }
  const deployed = v.adapters.reduce((s, a) => s + (a.quarantined ? 0n : a.totalAssets), 0n);
  const buffer = v.nav > deployed ? v.nav - deployed : 0n;
  const slices = [
    ...v.adapters.map((a, i) => ({ key: a.adapter, label: names[a.target.toLowerCase()]?.name ?? "Strategy", value: share(a.totalAssets, v.nav), color: CAT[i % CAT.length] ?? CAT[0]! })),
    { key: "buffer", label: "Liquidity buffer", value: share(buffer, v.nav), color: BUFFER_COLOR },
  ].filter((s) => s.value > 0);

  return (
    <Card>
      <CardHeader title="Allocation" description={`Live allocation vs. target weights across ${v.adapters.length} governance-approved strategies.`} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 p-5 sm:p-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-center">
        <div className="relative mx-auto size-[200px]">
          {slices.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="label" innerRadius={70} outerRadius={96} paddingAngle={slices.length > 1 ? 1.5 : 0} stroke="#0b0f18" strokeWidth={2} isAnimationActive={false} startAngle={90} endAngle={-270}>
                  {slices.map((s) => <Cell key={s.key} fill={s.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="size-full rounded-full border-[26px] border-surface-3" />
          )}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[11px] font-medium uppercase tracking-wide text-subtle">Deployed</span>
            <span className="tabular text-xl font-semibold text-fg">{formatPct(share(deployed, v.nav))}</span>
            <span className="tabular text-[11px] text-subtle">{formatValueCompact(deployed, v.baseDecimals, symbol)}</span>
          </div>
        </div>
        <ul className="grid gap-y-2.5" aria-label="Allocation legend">
          {slices.map((s) => (
            <li key={s.key} className="flex min-w-0 items-center gap-2.5 text-[13px]">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
              <span className="truncate text-muted">{s.label}</span>
              <span className="tabular ml-auto font-medium text-fg">{formatPct(s.value)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-border">
        <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Strategies: target and current weights, value, realised APY and health</caption>
          <thead>
            <tr className="text-left text-xs text-subtle">
              <th scope="col" className="h-10 pl-5 pr-3 font-medium">Strategy</th>
              <th scope="col" className="px-3 text-right font-medium">Weight / target</th>
              <th scope="col" className="px-3 text-right font-medium">Drift</th>
              <th scope="col" className="px-3 text-right font-medium">Value</th>
              <th scope="col" className="px-3 text-right font-medium">Realised APY</th>
              <th scope="col" className="pl-3 pr-5 text-right font-medium">Health</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border border-t border-border">
            {v.adapters.map((a, i) => {
              const info = names[a.target.toLowerCase()];
              const drift = driftBps(a.totalAssets, a.targetAssets);
              const h = adapterHealth(a);
              // Weight among deployed strategies, comparable with the target weight (which applies after the buffer).
              const current = share(a.totalAssets, deployed);
              return (
                <tr key={a.adapter} className="transition-colors hover:bg-white/[0.015]">
                  <td className="py-3.5 pl-5 pr-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span aria-hidden="true" className="h-8 w-1 shrink-0 rounded-full" style={{ background: CAT[i % CAT.length] }} />
                      <ProtocolIcon protocol={protocolLabel(a.kind)} size={26} />
                      <div className="min-w-0">
                        <p className="max-w-[240px] truncate font-medium text-fg" title={info?.name}>{info?.name ?? "Strategy"}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle">
                          <span>{protocolLabel(a.kind)}</span>
                          <span aria-hidden="true">·</span>
                          <AddressLink address={a.target} copy={false} className="[&_a]:text-xs [&_span]:text-xs" />
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 text-right">
                    <span className="tabular whitespace-nowrap text-fg">{formatPct(current)} <span className="text-subtle">/ {formatPct(a.targetBps / 10_000)}</span></span>
                    <span className="ml-auto mt-1 block h-1 w-16 overflow-hidden rounded-full bg-surface-3">
                      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, current * 100)}%`, background: CAT[i % CAT.length] }} />
                    </span>
                  </td>
                  <td className={cn("tabular px-3 text-right", Number.isFinite(drift) && Math.abs(drift) > v.weightToleranceBps ? "text-warning" : "text-muted")}>{formatDriftBps(drift)}</td>
                  <td className="px-3 text-right text-fg">
                    <Tooltip content={formatValuePrecise(a.totalAssets, v.baseDecimals, symbol)}>
                      <span tabIndex={0} className="tabular">{formatValueCompact(a.totalAssets, v.baseDecimals, symbol)}</span>
                    </Tooltip>
                  </td>
                  <td className="px-3 text-right"><ApyCell apy={apys.data?.[a.target.toLowerCase()] ?? null} loading={apys.isLoading} /></td>
                  <td className="pl-3 pr-5 text-right"><Badge tone={h.tone} dot>{h.label}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        <ul className="divide-y divide-border md:hidden">
          {v.adapters.map((a, i) => {
            const info = names[a.target.toLowerCase()];
            const h = adapterHealth(a);
            return (
              <li key={a.adapter} className="space-y-3 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="h-8 w-1 shrink-0 rounded-full" style={{ background: CAT[i % CAT.length] }} />
                  <ProtocolIcon protocol={protocolLabel(a.kind)} size={26} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{info?.name ?? "Strategy"}</p>
                    <p className="text-xs text-subtle">{protocolLabel(a.kind)}</p>
                  </div>
                  <Badge tone={h.tone} dot>{h.label}</Badge>
                </div>
                <dl className="grid grid-cols-4 gap-2 text-xs">
                  <div><dt className="text-subtle">Target</dt><dd className="tabular mt-0.5 text-fg">{formatPct(a.targetBps / 10_000)}</dd></div>
                  <div><dt className="text-subtle">Weight</dt><dd className="tabular mt-0.5 text-fg">{formatPct(share(a.totalAssets, deployed))}</dd></div>
                  <div><dt className="text-subtle">Value</dt><dd className="tabular mt-0.5 text-fg">{formatValueCompact(a.totalAssets, v.baseDecimals, symbol)}</dd></div>
                  <div className="text-right"><dt className="text-subtle">APY</dt><dd className="mt-0.5"><ApyCell apy={apys.data?.[a.target.toLowerCase()] ?? null} loading={apys.isLoading} /></dd></div>
                </dl>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-border px-5 py-3.5 text-xs text-subtle sm:px-6">
          Weights are shares of deployed assets; targets apply after the {formatPct(v.liquidBufferBps / 10_000)} liquidity buffer. Drift tolerance ±{formatPct(v.weightToleranceBps / 10_000)}; keepers rebalance beyond it.
        </p>
      </div>
    </Card>
  );
}
