/** Shared, display-oriented maths. On-chain values remain authoritative; these never round up. */

export const BPS = 10_000n;
export const WAD = 10n ** 18n;

export function bpsToPercent(bps: number | bigint): number {
  return Number(bps) / 100;
}

/** Applies a slippage tolerance (in bps) to an expected amount, rounding down. */
export function withSlippage(amount: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10_000) throw new Error("slippage out of range");
  return (amount * (BPS - BigInt(slippageBps))) / BPS;
}

export type RedemptionMode = "instant" | "queued" | "unavailable";

export interface RedemptionEstimate {
  mode: RedemptionMode;
  /** Expected assets at current NAV; queued requests settle at fill-time NAV instead. */
  expectedAssets: bigint;
  /** Free liquidity that could pay the redemption right now. */
  availableLiquidity: bigint;
  /** Portion of the claim that free liquidity cannot cover today. */
  shortfall: bigint;
  reason?: string;
}

/**
 * Classifies a redemption from `IndexLens.previewRedeem` output. Never promises instant liquidity
 * the vault does not have: a claim larger than free liquidity is always "queued".
 */
export function estimateRedemption(params: {
  expectedAssets: bigint;
  availableLiquidity: bigint;
  redemptionsPaused: boolean;
  queueFull: boolean;
}): RedemptionEstimate {
  const { expectedAssets, availableLiquidity } = params;
  const shortfall = expectedAssets > availableLiquidity ? expectedAssets - availableLiquidity : 0n;
  const base = { expectedAssets, availableLiquidity, shortfall };
  if (params.redemptionsPaused) return { ...base, mode: "unavailable", reason: "Redemptions are paused by the guardian." };
  if (shortfall === 0n) return { ...base, mode: "instant" };
  if (params.queueFull) return { ...base, mode: "unavailable", reason: "The redemption queue is full." };
  return {
    ...base,
    mode: "queued",
    reason: "Free liquidity is below this claim. Shares are escrowed and paid FIFO as keepers withdraw from underlying vaults.",
  };
}

/** Drift of an adapter from its target, in bps of the target (positive = overweight). */
export function driftBps(current: bigint, target: bigint): number {
  if (target === 0n) return current === 0n ? 0 : Number.POSITIVE_INFINITY;
  return Number(((current - target) * BPS) / target);
}

/** Formats a fixed-point integer with `decimals` into a human string with up to `maxFraction` digits. */
export function formatUnitsFixed(value: bigint, decimals: number, maxFraction = 2): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = abs % scale;
  let frac = fraction.toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = negative ? "-" : "";
  return frac.length > 0 ? `${sign}${wholeStr}.${frac}` : `${sign}${wholeStr}`;
}

/** Price per share is `nav * 1e18 / supply`, expressed in base-asset units. */
export function sharesToAssets(shares: bigint, pricePerShare: bigint): bigint {
  return (shares * pricePerShare) / WAD;
}
