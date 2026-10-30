import { describe, expect, it } from "vitest";
import { estimateRedemption, formatUnitsFixed, withSlippage, driftBps } from "../src/math.js";
import { adapterKindName, ADAPTER_KIND_HASH } from "../src/kinds.js";
import { parseDeployment } from "../src/deployment.js";

describe("estimateRedemption", () => {
  const base = { redemptionsPaused: false, queueFull: false };
  it("is instant only when free liquidity covers the full claim", () => {
    expect(estimateRedemption({ ...base, expectedAssets: 10n, availableLiquidity: 10n }).mode).toBe("instant");
    const q = estimateRedemption({ ...base, expectedAssets: 11n, availableLiquidity: 10n });
    expect(q.mode).toBe("queued");
    expect(q.shortfall).toBe(1n);
  });
  it("reports unavailable when paused or queue full", () => {
    expect(estimateRedemption({ ...base, redemptionsPaused: true, expectedAssets: 1n, availableLiquidity: 5n }).mode).toBe("unavailable");
    expect(estimateRedemption({ ...base, queueFull: true, expectedAssets: 9n, availableLiquidity: 5n }).mode).toBe("unavailable");
  });
});

describe("formatting and maths", () => {
  it("formats fixed point without rounding up", () => {
    expect(formatUnitsFixed(1_234_567_899n, 6)).toBe("1,234.56");
    expect(formatUnitsFixed(1_000_000n, 6)).toBe("1");
    expect(formatUnitsFixed(-5_500_000n, 6, 1)).toBe("-5.5");
  });
  it("applies slippage rounding down", () => {
    expect(withSlippage(1000n, 50)).toBe(995n);
    expect(() => withSlippage(1n, 10_001)).toThrow();
  });
  it("computes drift", () => {
    expect(driftBps(110n, 100n)).toBe(1000);
    expect(driftBps(0n, 0n)).toBe(0);
  });
});

describe("kinds and deployments", () => {
  it("round-trips adapter kind hashes", () => {
    expect(adapterKindName(ADAPTER_KIND_HASH.MORPHO)).toBe("MORPHO");
    expect(adapterKindName("0x00")).toBe("UNKNOWN");
  });
  it("rejects malformed deployments", () => {
    expect(() => parseDeployment({ chainId: 1 })).toThrow(/registry/);
  });
});
