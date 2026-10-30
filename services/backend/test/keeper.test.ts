import { describe, expect, it } from "vitest";
import {
  decideDrift,
  decideExpire,
  decideProcess,
  decideRebalance,
  planNextAction,
  targetBalance,
} from "../src/keeper/decisions.js";
import { AlertNotifier, evaluateAlerts } from "../src/keeper/alerts.js";
import type { IndexState } from "../src/keeper/state.js";
import { silentLogger } from "../src/util/log.js";
import { ADAPTER_A, ADAPTER_B, POLICY, VAULT, adapterView, indexView, openRequest } from "./helpers.js";

const state = (over: Partial<IndexState> = {}): IndexState => ({ view: indexView(), openRequests: [], now: 2_000, ...over });

describe("keeper decisions", () => {
  it("does nothing for a balanced index", () => {
    expect(planNextAction(state(), POLICY, new Set())).toBeUndefined();
  });

  it("processes when there are payable open requests and a base balance", () => {
    const s = state({ openRequests: [openRequest(0n, 50n)] });
    expect(decideProcess(s, POLICY)).toEqual({ kind: "processRedemptions", index: VAULT, maxRequests: 1n });
    expect(decideProcess(state({ openRequests: [openRequest(0n, 50n)], view: indexView({ baseBalance: 0n }) }), POLICY)).toBeUndefined();
    expect(decideProcess(s, { ...POLICY, enableProcess: false })).toBeUndefined();
  });

  it("skips processing when the head cannot be paid and partial fills are off", () => {
    const s = state({ openRequests: [openRequest(0n, 500n)], view: indexView({ partialFillsEnabled: false }) });
    expect(decideProcess(s, POLICY)).toBeUndefined();
  });

  it("visits past floor-blocked requests (maxRequests counts visits)", () => {
    const blocked = openRequest(0n, 10n, { minAssetsOut: 1_000n });
    const s = state({ openRequests: [blocked, openRequest(1n, 10n)] });
    expect(decideProcess(s, POLICY)).toMatchObject({ maxRequests: 2n });
    expect(decideProcess(state({ openRequests: [blocked] }), POLICY)).toBeUndefined();
  });

  it("rebalances on queue shortfall, buffer shortfall and excess, but not inside tolerance", () => {
    const queue = state({ view: indexView({ baseBalance: 50n, reservedAssets: 400n }), openRequests: [openRequest(0n, 400n)] });
    expect(decideRebalance(queue, POLICY)).toMatchObject({ reason: "queue_shortfall" });
    expect(decideRebalance(state({ view: indexView({ baseBalance: 50n }) }), POLICY)).toMatchObject({ reason: "buffer_shortfall" });
    expect(decideRebalance(state({ view: indexView({ baseBalance: 95n }) }), POLICY)).toBeUndefined();
    expect(decideRebalance(state({ view: indexView({ baseBalance: 200n }) }), POLICY)).toMatchObject({ reason: "excess" });
    expect(decideRebalance(state({ view: indexView({ baseBalance: 120n }) }), POLICY)).toBeUndefined();
    expect(decideRebalance(state({ view: indexView({ baseBalance: 200n, shutdown: true }) }), POLICY)).toBeUndefined();
    expect(decideRebalance(state({ view: indexView({ baseBalance: 50n }) }), { ...POLICY, enableRebalance: false })).toBeUndefined();
  });

  it("does not try to raise liquidity when no adapter can be withdrawn from", () => {
    const view = indexView({ baseBalance: 50n, adapters: [adapterView({ maxWithdraw: 0n })] });
    expect(decideRebalance(state({ view }), POLICY)).toBeUndefined();
  });

  it("pulls from an overweight adapter bounded by maxWithdraw", () => {
    const view = indexView({ adapters: [adapterView({ totalAssets: 1_200n, targetAssets: 900n, maxWithdraw: 100n })] });
    expect(decideDrift(state({ view }), POLICY)).toMatchObject({ kind: "pullFromAdapter", adapter: ADAPTER_A, assets: 100n });
    expect(decideDrift(state({ view }), { ...POLICY, enableDrift: false })).toBeUndefined();
  });

  it("pushes to an underweight adapter within free liquidity and the on-chain cap", () => {
    // NAV 1000, target balance 100, so 150 of 250 base is free above target.
    const view = indexView({
      baseBalance: 250n,
      adapters: [adapterView({ targetBps: 5_000, totalAssets: 300n, targetAssets: 450n }), adapterView({ adapter: ADAPTER_B, targetBps: 5_000, totalAssets: 450n, targetAssets: 450n })],
    });
    expect(targetBalance(view)).toBe(100n);
    expect(decideDrift(state({ view }), POLICY)).toMatchObject({ kind: "pushToAdapter", adapter: ADAPTER_A, assets: 150n });
    const unhealthy = indexView({ ...view, adapters: [adapterView({ targetBps: 5_000, totalAssets: 300n, targetAssets: 450n, healthy: false })] });
    expect(decideDrift(state({ view: unhealthy }), POLICY)).toBeUndefined();
  });

  it("ignores drift below the threshold", () => {
    const view = indexView({ adapters: [adapterView({ totalAssets: 920n, targetAssets: 900n })] });
    expect(decideDrift(state({ view }), POLICY)).toBeUndefined();
  });

  it("expires requests past expiry judged by chain time", () => {
    const s = state({ openRequests: [openRequest(3n, 10n, { expiresAt: 1_999n })] });
    expect(decideExpire(s, POLICY)).toEqual({ kind: "expireRedemption", index: VAULT, requestId: 3n });
    expect(decideExpire(state({ openRequests: [openRequest(3n, 10n, { expiresAt: 2_000n })] }), POLICY)).toBeUndefined();
    expect(decideExpire(s, { ...POLICY, enableExpire: false })).toBeUndefined();
  });

  it("plans in priority order and never repeats or mixes rebalance with drift in one tick", () => {
    const view = indexView({ baseBalance: 50n, reservedAssets: 400n, adapters: [adapterView({ totalAssets: 1_200n, targetAssets: 900n })] });
    const s = state({ view, openRequests: [openRequest(0n, 400n)] });
    const done = new Set<string>();
    const first = planNextAction(s, POLICY, done);
    expect(first?.kind).toBe("rebalance");
    done.add(`${VAULT}:rebalance`);
    expect(planNextAction(s, POLICY, done)?.kind).toBe("processRedemptions");
    done.add(`${VAULT}:processRedemptions`);
    expect(planNextAction(s, POLICY, done)).toBeUndefined();
  });
});

describe("keeper alerts", () => {
  it("raises monitoring alerts", () => {
    const view = indexView({
      navHealthy: false,
      depositsPaused: true,
      redemptionsPaused: true,
      shutdown: true,
      baseBalance: 10n,
      adapters: [adapterView({ healthy: false })],
    });
    const s = state({ view, now: 100_000, openRequests: [openRequest(0n, 10n, { requestedAt: 1n, minAssetsOut: 10n ** 20n, expiresAt: 10n ** 9n })] });
    const codes = evaluateAlerts(s, POLICY).map((a) => a.code).sort();
    expect(codes).toEqual(
      ["ADAPTER_UNHEALTHY", "DEPOSITS_PAUSED", "LIQUIDITY_BELOW_BUFFER", "NAV_UNHEALTHY", "QUEUE_FLOOR_BLOCKED", "QUEUE_STALE", "REDEMPTIONS_PAUSED", "SHUTDOWN"].sort(),
    );
    expect(evaluateAlerts(state(), POLICY)).toEqual([]);
  });

  it("dedupes webhook posts within the cooldown", async () => {
    const posts: string[] = [];
    let t = 0;
    const n = new AlertNotifier(silentLogger, { webhookUrl: "https://hooks.example/x", cooldownMs: 1_000, now: () => t, post: async (_u, b) => void posts.push(b) });
    const a = { code: "SHUTDOWN" as const, severity: "critical" as const, index: VAULT, subject: "", message: "x" };
    await n.notify([a]);
    await n.notify([a]);
    t = 2_000;
    await n.notify([a]);
    expect(posts).toHaveLength(2);
  });
});
