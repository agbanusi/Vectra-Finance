import { describe, expect, it, vi } from "vitest";
import { annualize, apyFromSnapshots, computeChainApys, labelForSpan, ppsRatio, sampleBlocks, YEAR_SECONDS } from "@/lib/apy";
import { snapshotSeries } from "@/lib/history";
import { isPrunedHistoryError } from "@/lib/rpc";

const DAY = 86_400;
const BLOCK_TIME = 12;

/** A chain where pps grows continuously at `rate` APY from `launchBlock`; blocks older than `prunedBelow` throw 4444. */
function fakeChain(opts: { head: bigint; rate: number; launchBlock: bigint; prunedBelow: bigint }) {
  const headTs = 1_800_000_000;
  const ts = (b: bigint) => headTs - Number(opts.head - b) * BLOCK_TIME;
  const pps = (b: bigint) => (b < opts.launchBlock ? null : Math.pow(1 + opts.rate, (ts(b) - ts(opts.launchBlock)) / YEAR_SECONDS));
  const readMany = vi.fn(async (b: bigint, targets: readonly string[]) => {
    if (b < opts.prunedBelow) throw Object.assign(new Error("RPC Request failed."), { cause: { code: 4444, message: "pruned history unavailable" } });
    return targets.map(() => pps(b));
  });
  return {
    head: { block: opts.head, timestamp: headTs },
    readMany,
    timestampOf: async (b: bigint) => ts(b),
    current: [pps(opts.head)],
  };
}

describe("annualize", () => {
  it("compounds growth over the window", () => {
    expect(annualize(1, 1.05, YEAR_SECONDS)).toBeCloseTo(0.05, 10);
    expect(annualize(1, Math.pow(1.08, 7 / 365), 7 * DAY)).toBeCloseTo(0.08, 8);
  });
  it("refuses tiny windows and bad inputs", () => {
    expect(annualize(1, 1.001, 60)).toBeNull();
    expect(annualize(0, 1, DAY)).toBeNull();
    expect(annualize(1, Number.NaN, DAY)).toBeNull();
  });
});

describe("ppsRatio", () => {
  it("keeps precision beyond 6-decimal price per share", () => {
    const a = ppsRatio(300_000_000_000n, 300_000n * 10n ** 18n);
    const b = ppsRatio(300_000_000_001n, 300_000n * 10n ** 18n);
    expect(a).not.toBeNull();
    expect(b! > a!).toBe(true);
    expect(ppsRatio(1n, 0n)).toBeNull();
  });
});

describe("computeChainApys", () => {
  const base = { startBlock: 0n, blockTime: BLOCK_TIME };

  it("uses the 7d window when history is available", async () => {
    const c = fakeChain({ head: 1_000_000n, rate: 0.06, launchBlock: 0n, prunedBelow: 0n });
    const [r] = await computeChainApys(["v"], { ...base, ...c });
    expect(r?.label).toBe("7d");
    expect(r?.apy).toBeCloseTo(0.06, 6);
    expect(r?.source).toBe("chain");
  });

  it("falls back to 24h when 7d-old state is pruned (error 4444)", async () => {
    const head = 1_000_000n;
    const c = fakeChain({ head, rate: 0.07, launchBlock: 0n, prunedBelow: head - 9_000n });
    const [r] = await computeChainApys(["v"], { ...base, ...c });
    expect(r?.label).toBe("24h");
    expect(r?.apy).toBeCloseTo(0.07, 6);
    expect(c.readMany).toHaveBeenCalledTimes(2);
  });

  it("falls through every window to null when nothing is servable", async () => {
    const head = 1_000_000n;
    const c = fakeChain({ head, rate: 0.07, launchBlock: 0n, prunedBelow: head });
    expect(await computeChainApys(["v"], { ...base, ...c })).toEqual([null]);
  });

  it("labels 'since launch' and locates the launch block for young indexes", async () => {
    const head = 1_000_000n;
    const launch = head - 1_200n; // ~4h old
    const c = fakeChain({ head, rate: 0.05, launchBlock: launch, prunedBelow: 0n });
    const [r] = await computeChainApys(["v"], { ...base, startBlock: head - 1_500n, blockTime: BLOCK_TIME, head: c.head, readMany: c.readMany, timestampOf: c.timestampOf, current: c.current });
    expect(r?.label).toBe("since launch");
    expect(r?.apy).toBeCloseTo(0.05, 4);
  });

  it("returns null for targets with no current data", async () => {
    const c = fakeChain({ head: 1_000_000n, rate: 0.05, launchBlock: 0n, prunedBelow: 0n });
    expect(await computeChainApys(["v"], { ...base, ...c, current: [null] })).toEqual([null]);
  });
});

describe("apyFromSnapshots", () => {
  it("annualises the last 7 days of indexed snapshots", () => {
    const t0 = 1_700_000_000;
    const points = Array.from({ length: 15 }, (_, i) => ({ t: t0 + i * DAY, pps: Math.pow(1.1, (i * DAY) / YEAR_SECONDS) }));
    const r = apyFromSnapshots(points);
    expect(r?.label).toBe("7d");
    expect(r?.apy).toBeCloseTo(0.1, 6);
    expect(r?.source).toBe("api");
  });
  it("labels short histories honestly and needs two points", () => {
    expect(apyFromSnapshots([{ t: 1, pps: 1 }])).toBeNull();
    const r = apyFromSnapshots([{ t: 0, pps: 1 }, { t: 3 * 3_600, pps: 1.0001 }]);
    expect(r?.label).toBe("3h (all indexed)");
  });
  it("derives precise pps from nav/supply in API snapshots", () => {
    const s = snapshotSeries([{ indexAddress: "0x", blockNumber: 1, timestamp: 10, nav: "2000000", totalSupply: "1000000000000000000", pricePerShare: "2000000", availableLiquidity: "0", reservedAssets: "0", navHealthy: true }], 6);
    expect(s[0]?.pps).toBeCloseTo(2, 10);
    expect(s[0]?.nav).toBe(2);
  });
});

describe("labelForSpan / sampleBlocks", () => {
  it("labels spans", () => {
    expect(labelForSpan(7 * DAY)).toBe("7d");
    expect(labelForSpan(DAY)).toBe("24h");
    expect(labelForSpan(5 * 3_600)).toBe("5h");
    expect(labelForSpan(120)).toBe("2m");
  });
  it("samples evenly and clamps to the deployment start", () => {
    expect(sampleBlocks(1_000n, 0n, 120, 12, 3)).toEqual([990n, 995n, 1_000n]);
    expect(sampleBlocks(1_000n, 900n, 7 * DAY, 12, 3)).toEqual([900n, 950n, 1_000n]);
    expect(sampleBlocks(1_000n, 1_000n, DAY, 12, 5)).toEqual([1_000n]);
  });
});

describe("isPrunedHistoryError", () => {
  it("recognises pruned / missing state errors anywhere in the cause chain", () => {
    expect(isPrunedHistoryError({ code: 4444 })).toBe(true);
    expect(isPrunedHistoryError(new Error("missing trie node abc"))).toBe(true);
    expect(isPrunedHistoryError({ message: "outer", cause: { details: "History has been pruned for this block" } })).toBe(true);
    expect(isPrunedHistoryError(new Error("execution reverted"))).toBe(false);
  });
});
