import { protocolLabel } from "@/lib/filters";
import type { IndexView } from "@/lib/types";
import { AllocationBar, type AllocationSlice } from "../ui/AllocationBar";
import { PROTOCOL_COLOR, ProtocolStack } from "../ui/TokenIcon";

/** Live allocation by protocol (share of NAV), plus the idle buffer. */
export function protocolSlices(v: IndexView): AllocationSlice[] {
  const byProtocol = new Map<string, bigint>();
  for (const a of v.adapters) {
    if (a.quarantined) continue;
    const p = protocolLabel(a.kind);
    byProtocol.set(p, (byProtocol.get(p) ?? 0n) + a.totalAssets);
  }
  const total = v.nav > 0n ? v.nav : [...byProtocol.values()].reduce((x, y) => x + y, 0n);
  if (total === 0n) {
    // Nothing deployed yet: show target weights instead.
    return [...new Set(v.adapters.map((a) => protocolLabel(a.kind)))].map((p) => ({
      key: p,
      label: p,
      weight: v.adapters.filter((a) => protocolLabel(a.kind) === p).reduce((s, a) => s + a.targetBps, 0) / 10_000,
      color: PROTOCOL_COLOR[p] ?? PROTOCOL_COLOR.Other!,
    }));
  }
  const slices = [...byProtocol.entries()].map(([p, amt]) => ({ key: p, label: p, weight: Number((amt * 10_000n) / total) / 10_000, color: PROTOCOL_COLOR[p] ?? PROTOCOL_COLOR.Other! }));
  const deployed = slices.reduce((s, x) => s + x.weight, 0);
  if (deployed < 1) slices.push({ key: "buffer", label: "Liquidity buffer", weight: 1 - deployed, color: PROTOCOL_COLOR.Buffer! });
  return slices;
}

export function Exposure({ index: v, compact = false }: { index: IndexView; compact?: boolean }) {
  const protocols = [...new Set(v.adapters.map((a) => protocolLabel(a.kind)))];
  return (
    <div className={compact ? "flex items-center gap-3" : "flex min-w-[140px] flex-col gap-2"}>
      <div className="flex items-center gap-2">
        <ProtocolStack protocols={protocols} />
        <span className="text-xs text-subtle">{v.adapters.length} strateg{v.adapters.length === 1 ? "y" : "ies"}</span>
      </div>
      {compact ? null : <AllocationBar slices={protocolSlices(v)} height={4} />}
    </div>
  );
}
