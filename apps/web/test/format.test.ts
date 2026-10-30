import { describe, expect, it } from "vitest";
import { formatAmount, formatBps, formatDriftBps, formatDuration, formatPricePerShare, formatShares, parseAmountInput, ratioBps } from "@/lib/format";

describe("formatAmount", () => {
  it("formats with base decimals and grouping", () => {
    expect(formatAmount(1_234_567_890n, 6)).toBe("1,234.56");
    expect(formatAmount(0n, 6)).toBe("0");
  });
  it("never rounds up and flags dust", () => {
    expect(formatAmount(1_999_999n, 6)).toBe("1.99");
    expect(formatAmount(1n, 6)).toBe("<0.01");
  });
  it("formats 18-decimal shares", () => {
    expect(formatShares(1_500_000_000_000_000_000n)).toBe("1.5");
  });
  it("formats price per share in base units", () => {
    expect(formatPricePerShare(1_012_345n, 6)).toBe("1.012345");
  });
});

describe("parseAmountInput", () => {
  it("parses valid decimals", () => {
    expect(parseAmountInput("1.5", 6)).toBe(1_500_000n);
    expect(parseAmountInput(" 2 ", 18)).toBe(2n * 10n ** 18n);
  });
  it("rejects invalid input and excess precision", () => {
    expect(parseAmountInput("", 6)).toBeNull();
    expect(parseAmountInput("abc", 6)).toBeNull();
    expect(parseAmountInput("1.2.3", 6)).toBeNull();
    expect(parseAmountInput("-1", 6)).toBeNull();
    expect(parseAmountInput("0.0000001", 6)).toBeNull();
  });
});

describe("misc helpers", () => {
  it("formats bps", () => {
    expect(formatBps(50)).toBe("0.5%");
    expect(formatBps(1000)).toBe("10%");
    expect(formatBps(125)).toBe("1.25%");
  });
  it("computes ratios safely", () => {
    expect(ratioBps(1n, 4n)).toBe(2500);
    expect(ratioBps(1n, 0n)).toBe(0);
  });
  it("formats durations and drift", () => {
    expect(formatDuration(7 * 86_400)).toBe("7d");
    expect(formatDuration(3_700)).toBe("1h 1m");
    expect(formatDriftBps(250)).toBe("+2.50%");
    expect(formatDriftBps(Number.POSITIVE_INFINITY)).toBe("n/a");
  });
});

import { formatBpsPct, formatCompact, formatPct, formatRelative, formatValueCompact, formatValuePrecise, isUsdLike, toNumber } from "@/lib/format";

describe("compact & percentage formatting", () => {
  it("formats compact numbers, rounding down", () => {
    expect(formatCompact(1_249_999)).toBe("1.24M");
    expect(formatCompact(12_345)).toBe("12.34K");
    expect(formatCompact(950.129)).toBe("950.12");
    expect(formatCompact(2.5e9)).toBe("2.50B");
    expect(formatCompact(0.001)).toBe("<0.01");
    expect(formatCompact(Number.NaN)).toBe("—");
  });
  it("formats base-asset values as $ for USD-like assets", () => {
    expect(formatValueCompact(1_240_000_000_000n, 6, "tUSDC")).toBe("$1.24M");
    expect(formatValueCompact(5n * 10n ** 18n, 18, "WETH")).toBe("5.00 WETH");
    expect(formatValuePrecise(1_234_567n, 6, "USDC")).toBe("1.234567 USDC");
    expect(isUsdLike("tUSDC")).toBe(true);
    expect(toNumber(1_500_000n, 6)).toBe(1.5);
  });
  it("formats percentages with 2dp", () => {
    expect(formatPct(0.071234)).toBe("7.12%");
    expect(formatPct(0.01, { sign: true })).toBe("+1.00%");
    expect(formatPct(null)).toBe("—");
    expect(formatBpsPct(1250)).toBe("12.50%");
  });
  it("formats relative time", () => {
    expect(formatRelative(1_000, 1_030)).toBe("just now");
    expect(formatRelative(1_000, 1_000 + 7_200)).toBe("2h ago");
    expect(formatRelative(0, 3 * 86_400)).toBe("3d ago");
  });
});
