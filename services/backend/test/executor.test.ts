import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { Executor } from "../src/keeper/executor.js";
import { SimulationRevertedError, type TxBackend } from "../src/keeper/backend.js";
import type { KeeperAction } from "../src/keeper/decisions.js";
import { acquireLease, openDeadLetters, recentRuns, releaseLease } from "../src/db/jobs.js";
import { backoffDelay, RetryExhaustedError, withRetry } from "../src/util/retry.js";
import { silentLogger } from "../src/util/log.js";
import type { Alert } from "../src/keeper/alerts.js";
import type { Db } from "../src/db/database.js";
import { CHAIN_ID, VAULT, memDb } from "./helpers.js";

const ACTION: KeeperAction = { kind: "processRedemptions", index: VAULT, maxRequests: 5n };
const HASH = "0xabc" as Hex;

function backend(over: Partial<TxBackend> = {}): TxBackend & { sends: number } {
  const b = {
    sends: 0,
    account: VAULT,
    canSend: true,
    simulate: async () => ({ result: 1n, request: {} }),
    estimateFees: async () => ({ maxFeePerGas: 10n, maxPriorityFeePerGas: 1n }),
    async send() {
      b.sends++;
      return HASH;
    },
    waitForReceipt: async () => ({ status: "success" as const, blockNumber: 1n }),
    ...over,
  };
  return b;
}

function executor(db: Db, b: TxBackend, alerts: Alert[] = [], instanceId = "a") {
  const delays: number[] = [];
  const ex = new Executor({
    db,
    backend: b,
    chainId: CHAIN_ID,
    instanceId,
    leaseTtlMs: 60_000,
    maxFeePerGasWei: 100n,
    retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 },
    retryDeps: { sleep: async (ms) => void delays.push(ms), random: () => 1 },
    logger: silentLogger,
    onAlert: async (a) => void alerts.push(a),
    now: () => 1_000,
  });
  return { ex, delays };
}

describe("retry", () => {
  it("backs off exponentially with a cap", () => {
    const p = { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 500 };
    expect([1, 2, 3, 4].map((a) => backoffDelay(a, p, () => 1))).toEqual([100, 200, 400, 500]);
  });

  it("gives up after maxAttempts", async () => {
    let calls = 0;
    const run = withRetry(async () => { calls++; throw new Error("boom"); }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 }, { sleep: async () => {}, random: () => 0 });
    await expect(run).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(calls).toBe(3);
  });
});

describe("executor", () => {
  it("simulates, sends and records success", async () => {
    const db = memDb();
    const b = backend();
    const out = await executor(db, b).ex.execute(ACTION);
    expect(out).toMatchObject({ status: "success", txHash: HASH });
    expect(b.sends).toBe(1);
    expect(recentRuns(db, 5)[0]?.status).toBe("success");
  });

  it("does not send when simulation shows a no-op or a revert", async () => {
    const db = memDb();
    const noop = backend({ simulate: async () => ({ result: 0n, request: {} }) });
    expect((await executor(db, noop).ex.execute(ACTION)).status).toBe("noop");
    const reverting = backend({ simulate: async () => { throw new SimulationRevertedError("AccessControl"); } });
    expect((await executor(db, reverting).ex.execute(ACTION)).status).toBe("simulation_reverted");
    expect(noop.sends + reverting.sends).toBe(0);
    expect(openDeadLetters(db, 5)).toHaveLength(0);
  });

  it("dry-runs without a key and defers when gas exceeds the cap", async () => {
    const db = memDb();
    expect((await executor(db, backend({ canSend: false })).ex.execute(ACTION)).status).toBe("dry_run");
    const pricey = backend({ estimateFees: async () => ({ maxFeePerGas: 1_000n, maxPriorityFeePerGas: 1n }) });
    expect((await executor(db, pricey).ex.execute(ACTION)).status).toBe("deferred_gas");
    expect(pricey.sends).toBe(0);
  });

  it("retries transient send failures with backoff", async () => {
    const db = memDb();
    let n = 0;
    const b = backend({ send: async () => { if (++n < 3) throw new Error("nonce too low"); return HASH; } });
    const { ex, delays } = executor(db, b);
    expect(await ex.execute(ACTION)).toMatchObject({ status: "success", attempts: 3 });
    expect(delays).toEqual([100, 200]);
  });

  it("writes a dead letter and alerts after exhausting retries", async () => {
    const db = memDb();
    const alerts: Alert[] = [];
    const b = backend({ send: async () => { throw new Error("rpc 502"); } });
    const out = await executor(db, b, alerts).ex.execute(ACTION);
    expect(out).toMatchObject({ status: "failed", attempts: 3 });
    const dl = openDeadLetters(db, 5);
    expect(dl).toHaveLength(1);
    expect(dl[0]?.error).toContain("rpc 502");
    expect(alerts.map((a) => a.code)).toEqual(["TX_FAILED"]);
  });

  it("dead-letters an on-chain revert without resending", async () => {
    const db = memDb();
    const b = backend({ waitForReceipt: async () => ({ status: "reverted", blockNumber: 1n }) });
    expect((await executor(db, b).ex.execute(ACTION)).status).toBe("reverted");
    expect(b.sends).toBe(1);
    expect(openDeadLetters(db, 5)).toHaveLength(1);
  });

  it("enforces lease exclusivity across instances", async () => {
    const db = memDb();
    expect(acquireLease(db, "k", "a", 1_000, 0)).toBe(true);
    expect(acquireLease(db, "k", "b", 1_000, 500)).toBe(false);
    expect(acquireLease(db, "k", "a", 1_000, 500)).toBe(true); // renew by holder
    expect(acquireLease(db, "k", "b", 1_000, 1_600)).toBe(true); // expired
    releaseLease(db, "k", "a"); // non-holder release is a no-op
    expect(acquireLease(db, "k", "a", 1_000, 1_700)).toBe(false);

    const b = backend();
    const { ex } = executor(db, b, [], "instance-1");
    acquireLease(db, ex.leaseKey(ACTION), "instance-2", 60_000, 1_000);
    expect((await ex.execute(ACTION)).status).toBe("lease_busy");
    expect(b.sends).toBe(0);
  });
});

describe("bufferedGas", () => {
  it("adds 25% headroom over the estimate", async () => {
    const { bufferedGas } = await import("../src/keeper/backend.js");
    expect(bufferedGas(328_619n)).toBe(410_773n);
  });
});
