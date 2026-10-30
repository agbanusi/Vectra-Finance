import type { Address } from "viem";
import { BPS, driftBps } from "@vectra/sdk";
import type { KeeperPolicy } from "../config.js";
import type { AdapterView, IndexView, OpenRequest } from "../chain/reader.js";
import type { IndexState } from "./state.js";

/**
 * Pure keeper decision functions. They only choose *whether* a call is worthwhile; every call is
 * still simulated and fully enforced on-chain, so a wrong decision costs at most a skipped tx.
 */
export type KeeperAction =
  | { kind: "expireRedemption"; index: Address; requestId: bigint }
  | { kind: "rebalance"; index: Address; maxActions: bigint; reason: RebalanceReason }
  | { kind: "processRedemptions"; index: Address; maxRequests: bigint }
  | { kind: "pullFromAdapter"; index: Address; adapter: Address; assets: bigint; driftBps: number }
  | { kind: "pushToAdapter"; index: Address; adapter: Address; assets: bigint; driftBps: number };

export type RebalanceReason = "queue_shortfall" | "buffer_shortfall" | "excess";
export type ActionKind = KeeperAction["kind"];

/** Actions in the same group touch the same on-chain resource and must not run concurrently. */
export function leaseGroup(kind: ActionKind): "queue" | "liquidity" {
  return kind === "expireRedemption" || kind === "processRedemptions" ? "queue" : "liquidity";
}

export function actionKey(a: KeeperAction): string {
  return a.kind === "expireRedemption" ? `${a.index}:${a.kind}:${a.requestId}` : `${a.index}:${a.kind}`;
}

const sub = (a: bigint, b: bigint): bigint => (a > b ? a - b : 0n);
const min = (...xs: bigint[]): bigint => xs.reduce((m, x) => (x < m ? x : m));
const mulDiv = (a: bigint, b: bigint, d: bigint): bigint => (d === 0n ? 0n : (a * b) / d);

/** Mirrors IndexVault._targetBalance: reserved + buffer% of the remaining NAV. */
export function targetBalance(v: IndexView): bigint {
  const rest = sub(v.nav, v.reservedAssets);
  return v.reservedAssets + mulDiv(rest, BigInt(v.liquidBufferBps), BPS);
}

/** Mirrors IndexVault._targetInvestedNav. */
export function targetInvestedNav(v: IndexView): bigint {
  return mulDiv(sub(v.nav, v.reservedAssets), BPS - BigInt(v.liquidBufferBps), BPS);
}

export function claimOf(v: IndexView, shares: bigint): bigint {
  return mulDiv(shares, v.nav, v.totalSupply);
}

export function isExpired(r: OpenRequest, now: number): boolean {
  return BigInt(now) > r.request.expiresAt;
}

/** Requests processRedemptions would actually try to pay (live and above their NAV floor). */
export function eligibleRequests(state: IndexState): OpenRequest[] {
  return state.openRequests.filter(
    (r) => !isExpired(r, state.now) && claimOf(state.view, r.request.shares) >= r.request.minAssetsOut,
  );
}

export function decideExpire(state: IndexState, policy: KeeperPolicy): KeeperAction | undefined {
  if (!policy.enableExpire) return undefined;
  const expired = state.openRequests.find((r) => isExpired(r, state.now));
  return expired ? { kind: "expireRedemption", index: state.view.vault, requestId: expired.id } : undefined;
}

export function decideProcess(state: IndexState, policy: KeeperPolicy): KeeperAction | undefined {
  if (!policy.enableProcess) return undefined;
  const { view } = state;
  if (view.baseBalance === 0n) return undefined;
  const eligible = eligibleRequests(state);
  const head = eligible[0];
  if (!head) return undefined;
  // FIFO: the first eligible request must be at least partly payable or processing is a no-op.
  const payable = claimOf(view, head.request.shares) <= view.baseBalance || view.partialFillsEnabled;
  if (!payable) return undefined;
  // maxRequests bounds requests *visited*, so cover skipped (floor/expired) entries ahead of payable ones.
  const visit = Math.min(state.openRequests.length, policy.processMaxRequests);
  return { kind: "processRedemptions", index: view.vault, maxRequests: BigInt(Math.max(1, visit)) };
}

function withdrawable(v: IndexView): bigint {
  return v.adapters.filter((a) => !a.quarantined).reduce((s, a) => s + a.maxWithdraw, 0n);
}

function rebalanceReason(state: IndexState, policy: KeeperPolicy): RebalanceReason | undefined {
  const { view } = state;
  const target = targetBalance(view);
  const balance = view.baseBalance;
  if (balance < target) {
    if (eligibleRequests(state).length > 0 && view.reservedAssets > balance) return "queue_shortfall";
    const shortfallBps = mulDiv(target - balance, BPS, view.nav);
    return shortfallBps > BigInt(policy.rebalanceThresholdBps) ? "buffer_shortfall" : undefined;
  }
  const tolerance = mulDiv(view.nav, BigInt(view.weightToleranceBps), BPS);
  const canInvest = !view.shutdown && view.navHealthy;
  return canInvest && balance > target + tolerance ? "excess" : undefined;
}

export function decideRebalance(state: IndexState, policy: KeeperPolicy): KeeperAction | undefined {
  if (!policy.enableRebalance) return undefined;
  const reason = rebalanceReason(state, policy);
  if (!reason) return undefined;
  if (reason !== "excess" && withdrawable(state.view) === 0n) return undefined;
  return { kind: "rebalance", index: state.view.vault, maxActions: BigInt(policy.rebalanceMaxActions), reason };
}

function pullCandidate(v: IndexView, a: AdapterView, drift: number): KeeperAction | undefined {
  if (a.quarantined || !a.valuationOk) return undefined;
  const assets = min(sub(a.totalAssets, a.targetAssets), a.maxWithdraw);
  return assets > 0n ? { kind: "pullFromAdapter", index: v.vault, adapter: a.adapter, assets, driftBps: drift } : undefined;
}

/** Bounded exactly like IndexVault.pushToAdapter: free liquidity above target and target+tolerance cap. */
function pushCandidate(v: IndexView, a: AdapterView, drift: number): KeeperAction | undefined {
  if (v.shutdown || a.quarantined || !a.enabled || !a.healthy || !a.valuationOk) return undefined;
  const free = sub(v.baseBalance, targetBalance(v));
  const cap = mulDiv(targetInvestedNav(v), BigInt(a.targetBps) + BigInt(v.weightToleranceBps), BPS);
  const assets = min(sub(a.targetAssets, a.totalAssets), free, sub(cap, a.totalAssets), a.maxDeposit);
  return assets > 0n ? { kind: "pushToAdapter", index: v.vault, adapter: a.adapter, assets, driftBps: drift } : undefined;
}

/** Picks the single most drifted adapter beyond the threshold (one targeted fix per pass). */
export function decideDrift(state: IndexState, policy: KeeperPolicy): KeeperAction | undefined {
  if (!policy.enableDrift) return undefined;
  const { view } = state;
  const candidates = view.adapters
    .map((a) => ({ a, drift: driftBps(a.totalAssets, a.targetAssets) }))
    .filter(({ drift }) => Math.abs(drift) > policy.driftThresholdBps)
    .sort((x, y) => Math.abs(y.drift) - Math.abs(x.drift));
  for (const { a, drift } of candidates) {
    const action = drift > 0 ? pullCandidate(view, a, drift) : pushCandidate(view, a, drift);
    if (action) return action;
  }
  return undefined;
}

const DECIDERS = [decideExpire, decideRebalance, decideProcess, decideDrift] as const;

/**
 * Next action for an index, in priority order: expire (frees reservations) → rebalance (restores
 * liquidity) → process queue → drift. `done` holds keys already attempted this tick. Drift never runs
 * in a tick where a rebalance was attempted, so the two liquidity strategies cannot fight.
 */
export function planNextAction(state: IndexState, policy: KeeperPolicy, done: ReadonlySet<string>): KeeperAction | undefined {
  const rebalanced = done.has(`${state.view.vault}:rebalance`);
  for (const decide of DECIDERS) {
    if (decide === decideDrift && rebalanced) continue;
    const action = decide(state, policy);
    if (action && !done.has(actionKey(action))) return action;
  }
  return undefined;
}
