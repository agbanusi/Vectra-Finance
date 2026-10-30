"use client";

import { Lock, Search, X } from "lucide-react";
import type { Access, MarketFilters as Filters } from "@/lib/filters";
import { cn } from "../ui/cn";

interface Props {
  filters: Filters;
  curators: readonly string[];
  categories: readonly string[];
  onChange: (next: Filters) => void;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors",
        active ? "border-accent/50 bg-accent-soft text-accent-strong" : "border-border bg-surface text-muted hover:border-border-strong hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function MarketFilters({ filters, curators, categories, onChange }: Props) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  const toggle = (key: "curator" | "category", value: string) => set(key, filters[key] === value ? "" : value);
  const access: { value: Access; label: string }[] = [
    { value: "permissionless", label: "Permissionless" },
    { value: "restricted", label: "Restricted" },
  ];
  const active = filters.curator || filters.category || filters.access !== "all" || filters.search;
  return (
    <div role="search" className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="scrollbar-none -mx-4 flex items-center gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
        <Chip active={!active} onClick={() => onChange({ search: "", curator: "", category: "", access: "all" })}>All</Chip>
        {curators.map((c) => <Chip key={c} active={filters.curator === c} onClick={() => toggle("curator", c)}>{c}</Chip>)}
        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border-strong" />
        {categories.map((c) => <Chip key={c} active={filters.category === c} onClick={() => toggle("category", c)}>{c}</Chip>)}
        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border-strong" />
        {access.map((a) => (
          <Chip key={a.value} active={filters.access === a.value} onClick={() => set("access", filters.access === a.value ? "all" : a.value)}>
            {a.value === "restricted" ? <Lock className="size-3" aria-hidden="true" /> : null}
            {a.label}
          </Chip>
        ))}
      </div>
      <label className="relative block w-full lg:w-72">
        <span className="sr-only">Search indexes</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <input
          type="search"
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
          placeholder="Search name, symbol or address"
          className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-8 text-sm text-fg placeholder:text-subtle transition-colors focus:border-accent/60 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {filters.search ? (
          <button type="button" aria-label="Clear search" onClick={() => set("search", "")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-subtle hover:text-fg">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </label>
    </div>
  );
}
