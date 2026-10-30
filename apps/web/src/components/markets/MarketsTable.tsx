"use client";

import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Market } from "@/hooks/useMarkets";
import { bufferRatio, type SortDir, type SortKey } from "@/lib/filters";
import { formatPct, formatPricePerShare } from "@/lib/format";
import { cn } from "../ui/cn";
import { Value } from "../ui/Value";
import { ApyCell } from "./ApyCell";
import { Exposure } from "./Exposure";
import { IndexIdentity } from "./IndexIdentity";

interface Props {
  markets: readonly Market[];
  symbol: string;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  apyLoading: boolean;
}

const COLS: { key: SortKey | null; label: string; className: string; align?: "right" }[] = [
  { key: "name", label: "Index", className: "pl-5 w-[30%]" },
  { key: "tvl", label: "TVL", className: "", align: "right" },
  { key: "apy", label: "Realised APY", className: "", align: "right" },
  { key: "pps", label: "Price / share", className: "hidden xl:table-cell", align: "right" },
  { key: "buffer", label: "Buffer", className: "hidden lg:table-cell", align: "right" },
  { key: "liquidity", label: "Instant liquidity", className: "hidden lg:table-cell", align: "right" },
  { key: null, label: "Exposure", className: "pl-8" },
];

function SortHeader({ col, sort, onSort }: { col: (typeof COLS)[number]; sort: Props["sort"]; onSort: Props["onSort"] }) {
  if (!col.key) return <span>{col.label}</span>;
  const active = sort.key === col.key;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  const key = col.key;
  return (
    <button type="button" onClick={() => onSort(key)} className={cn("inline-flex items-center gap-1 rounded transition-colors hover:text-fg", active && "text-fg", col.align === "right" && "flex-row-reverse")}>
      {col.label}
      <Icon className={cn("size-3", active ? "opacity-100" : "opacity-50")} aria-hidden="true" />
    </button>
  );
}

export function MarketsTable({ markets, symbol, sort, onSort, apyLoading }: Props) {
  const router = useRouter();
  return (
    <>
      <div className="surface-card hidden overflow-hidden rounded-[var(--radius-xl)] md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Indexes, sortable by column</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-subtle">
              {COLS.map((c) => (
                <th
                  key={c.label}
                  scope="col"
                  aria-sort={c.key && sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn("h-11 px-4 font-medium", c.align === "right" && "text-right", c.className)}
                >
                  <SortHeader col={c} sort={sort} onSort={onSort} />
                </th>
              ))}
              <th scope="col" className="w-10"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {markets.map(({ index: v, meta, apy }) => {
              const href = `/app/index/${v.vault}`;
              return (
                <tr key={v.vault} onClick={() => router.push(href)} className="group cursor-pointer transition-colors hover:bg-white/[0.018]">
                  <td className="py-4 pl-5 pr-4">
                    <Link href={href} onClick={(e) => e.stopPropagation()} className="block rounded-lg focus-visible:outline-offset-4">
                      <IndexIdentity index={v} meta={meta} />
                    </Link>
                  </td>
                  <td className="px-4 text-right font-medium text-fg"><Value value={v.nav} decimals={v.baseDecimals} symbol={symbol} /></td>
                  <td className="px-4 text-right"><ApyCell apy={apy} loading={apyLoading} /></td>
                  <td className="tabular hidden px-4 text-right text-muted xl:table-cell">{formatPricePerShare(v.pricePerShare, v.baseDecimals)}</td>
                  <td className="tabular hidden px-4 text-right lg:table-cell">
                    <span className="text-fg">{formatPct(bufferRatio(v))}</span>
                    <span className="block text-[11px] text-subtle">target {formatPct(v.liquidBufferBps / 10_000)}</span>
                  </td>
                  <td className="hidden px-4 text-right text-fg lg:table-cell"><Value value={v.availableLiquidity} decimals={v.baseDecimals} symbol={symbol} /></td>
                  <td className="py-4 pl-8 pr-4"><Exposure index={v} /></td>
                  <td className="pr-4 text-subtle"><ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden="true" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {markets.map(({ index: v, meta, apy }) => (
          <li key={v.vault}>
            <Link href={`/app/index/${v.vault}`} className="surface-card block rounded-[var(--radius-xl)] p-4 transition-colors active:bg-surface-2">
              <div className="flex items-start justify-between gap-3">
                <IndexIdentity index={v} meta={meta} />
                <ApyCell apy={apy} loading={apyLoading} />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3 text-xs">
                <div>
                  <dt className="text-subtle">TVL</dt>
                  <dd className="mt-0.5 text-sm font-medium text-fg"><Value value={v.nav} decimals={v.baseDecimals} symbol={symbol} /></dd>
                </div>
                <div>
                  <dt className="text-subtle">Instant liq.</dt>
                  <dd className="mt-0.5 text-sm font-medium text-fg"><Value value={v.availableLiquidity} decimals={v.baseDecimals} symbol={symbol} /></dd>
                </div>
                <div>
                  <dt className="text-subtle">Price</dt>
                  <dd className="tabular mt-0.5 text-sm font-medium text-fg">{formatPricePerShare(v.pricePerShare, v.baseDecimals).slice(0, 7)}</dd>
                </div>
              </dl>
              <div className="mt-3"><Exposure index={v} /></div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
