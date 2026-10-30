import type { Hex } from "viem";
import type { Db } from "../db/database.js";
import { acquireLease, addDeadLetter, recordRun, releaseLease, type JobStatus } from "../db/jobs.js";
import type { Logger } from "../util/log.js";
import { errorMessage } from "../util/log.js";
import { stringifySafe } from "../util/json.js";
import { NonRetryableError, RetryExhaustedError, withRetry, type RetryDeps, type RetryPolicy } from "../util/retry.js";
import type { Alert } from "./alerts.js";
import { leaseGroup, type KeeperAction } from "./decisions.js";
import { SimulationRevertedError, type Simulation, type TxBackend } from "./backend.js";

export interface ExecutorOptions {
  db: Db;
  backend: TxBackend;
  chainId: number;
  instanceId: string;
  leaseTtlMs: number;
  maxFeePerGasWei: bigint;
  retry: RetryPolicy;
  retryDeps?: RetryDeps;
  logger: Logger;
  onAlert: (alert: Alert) => Promise<void>;
  now?: () => number;
}

export interface ExecutionOutcome {
  status: JobStatus;
  txHash?: Hex;
  attempts: number;
  detail?: string;
}

/** Whether a simulated return value means the call would change nothing (so it is not sent). */
export function isNoopResult(action: KeeperAction, result: unknown): boolean {
  if (action.kind === "rebalance") {
    const [raised, allocated] = result as readonly [bigint, bigint];
    return raised === 0n && allocated === 0n;
  }
  if (action.kind === "expireRedemption") return false;
  return result === 0n;
}

class ReceiptRevertedError extends NonRetryableError {}

/**
 * Executes one keeper action: lease → simulate → no-op/dry-run/gas checks → send with backoff →
 * receipt. Exhausted retries and on-chain reverts become dead letters and alerts.
 */
export class Executor {
  constructor(private readonly o: ExecutorOptions) {}

  leaseKey(action: KeeperAction): string {
    return `keeper:${this.o.chainId}:${action.index}:${leaseGroup(action.kind)}`;
  }

  async execute(action: KeeperAction): Promise<ExecutionOutcome> {
    const { o } = this;
    const key = this.leaseKey(action);
    const startedAt = this.now();
    if (!acquireLease(o.db, key, o.instanceId, o.leaseTtlMs, startedAt)) {
      return this.finish(key, action, startedAt, { status: "lease_busy", attempts: 0 });
    }
    try {
      return this.finish(key, action, startedAt, await this.run(key, action));
    } finally {
      releaseLease(o.db, key, o.instanceId);
    }
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private async run(key: string, action: KeeperAction): Promise<ExecutionOutcome> {
    const preflight = await this.preflight(action);
    if (preflight) return preflight;
    return this.sendWithRetry(key, action);
  }

  /** First simulation: decides whether there is anything worth sending at all. */
  private async preflight(action: KeeperAction): Promise<ExecutionOutcome | undefined> {
    const { backend } = this.o;
    let sim: Simulation;
    try {
      sim = await withRetry(() => this.simulate(action), this.o.retry, this.o.retryDeps);
    } catch (err) {
      return this.simulationFailure(err);
    }
    if (isNoopResult(action, sim.result)) return { status: "noop", attempts: 1, detail: "simulated result is a no-op" };
    if (!backend.canSend) return { status: "dry_run", attempts: 1, detail: `would send; simulated ${stringifySafe(sim.result)}` };
    const fees = await backend.estimateFees();
    if (fees.maxFeePerGas > this.o.maxFeePerGasWei) {
      return { status: "deferred_gas", attempts: 1, detail: `maxFeePerGas ${fees.maxFeePerGas} > cap ${this.o.maxFeePerGasWei}` };
    }
    return undefined;
  }

  private async simulate(action: KeeperAction): Promise<Simulation> {
    try {
      return await this.o.backend.simulate(action);
    } catch (err) {
      if (err instanceof SimulationRevertedError) throw new NonRetryableError(err.message);
      throw err;
    }
  }

  private simulationFailure(err: unknown): ExecutionOutcome {
    if (err instanceof NonRetryableError) return { status: "simulation_reverted", attempts: 1, detail: err.message };
    throw err;
  }

  /** Each attempt re-simulates against fresh state and re-checks gas before broadcasting. */
  private async sendWithRetry(key: string, action: KeeperAction): Promise<ExecutionOutcome> {
    const { backend } = this.o;
    let attempts = 0;
    let hash: Hex | undefined;
    try {
      hash = await withRetry(
        async (attempt) => {
          attempts = attempt;
          await this.simulate(action);
          const fees = await backend.estimateFees();
          const capped = { ...fees, maxFeePerGas: fees.maxFeePerGas > this.o.maxFeePerGasWei ? this.o.maxFeePerGasWei : fees.maxFeePerGas };
          return backend.send(action, capped);
        },
        this.o.retry,
        this.o.retryDeps,
      );
      const receipt = await withRetry(() => backend.waitForReceipt(hash as Hex), this.o.retry, this.o.retryDeps);
      if (receipt.status !== "success") throw new ReceiptRevertedError(`transaction ${hash} reverted`);
      return { status: "success", attempts, txHash: hash };
    } catch (err) {
      return this.failure(key, action, err, attempts, hash);
    }
  }

  private async failure(key: string, action: KeeperAction, err: unknown, attempts: number, hash: Hex | undefined): Promise<ExecutionOutcome> {
    const detail = err instanceof RetryExhaustedError ? errorMessage(err.lastError) : errorMessage(err);
    if (err instanceof NonRetryableError && !(err instanceof ReceiptRevertedError) && hash === undefined) {
      // State moved between preflight and send so the call now reverts: nothing was broadcast.
      return { status: "simulation_reverted", attempts, detail };
    }
    addDeadLetter(this.o.db, { jobKey: key, actionJson: stringifySafe(action), error: detail, attempts, createdAt: this.now() });
    await this.o.onAlert({
      code: "TX_FAILED",
      severity: "critical",
      index: action.index,
      subject: action.kind,
      message: `${action.kind} failed after ${attempts} attempt(s): ${detail}`,
    });
    return { status: err instanceof ReceiptRevertedError ? "reverted" : "failed", attempts, detail, ...(hash ? { txHash: hash } : {}) };
  }

  private finish(key: string, action: KeeperAction, startedAt: number, outcome: ExecutionOutcome): ExecutionOutcome {
    recordRun(this.o.db, {
      jobKey: key,
      action: stringifySafe(action),
      status: outcome.status,
      attempts: outcome.attempts,
      txHash: outcome.txHash ?? null,
      detail: outcome.detail ?? null,
      startedAt,
      finishedAt: this.now(),
    });
    this.o.logger.info("keeper action", { action: action.kind, index: action.index, status: outcome.status, tx: outcome.txHash, detail: outcome.detail });
    return outcome;
  }
}
