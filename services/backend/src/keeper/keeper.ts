import type { Address } from "viem";
import type { KeeperPolicy } from "../config.js";
import type { ProtocolReader } from "../chain/reader.js";
import type { Logger } from "../util/log.js";
import { errorMessage } from "../util/log.js";
import { evaluateAlerts, type AlertNotifier } from "./alerts.js";
import { actionKey, planNextAction } from "./decisions.js";
import type { ExecutionOutcome, Executor } from "./executor.js";
import { loadIndexState } from "./state.js";

export interface KeeperDeps {
  reader: ProtocolReader;
  executor: Executor;
  notifier: AlertNotifier;
  policy: KeeperPolicy;
  logger: Logger;
  /** Index list provider (indexer DB ∪ deployment file); re-read every tick. */
  indexes: () => Address[];
}

export interface IndexTickReport {
  index: Address;
  actions: { key: string; outcome: ExecutionOutcome }[];
  alerts: number;
  error?: string;
}

/** Stateless across ticks: every decision is re-derived from fresh chain reads, so restarts are safe. */
export class Keeper {
  constructor(private readonly d: KeeperDeps) {}

  async tick(): Promise<IndexTickReport[]> {
    const reports: IndexTickReport[] = [];
    for (const index of this.d.indexes()) reports.push(await this.tickIndex(index));
    return reports;
  }

  private async tickIndex(index: Address): Promise<IndexTickReport> {
    const report: IndexTickReport = { index, actions: [], alerts: 0 };
    try {
      await this.runIndex(index, report);
    } catch (err) {
      report.error = errorMessage(err);
      await this.d.notifier.notify([
        { code: "KEEPER_ERROR", severity: "warning", index, subject: "tick", message: `keeper tick failed: ${report.error}` },
      ]);
    }
    return report;
  }

  private async runIndex(index: Address, report: IndexTickReport): Promise<void> {
    const done = new Set<string>();
    for (let i = 0; i < this.d.policy.maxActionsPerIndexTick; i++) {
      const state = await loadIndexState(this.d.reader, index);
      if (i === 0) report.alerts = await this.d.notifier.notify(evaluateAlerts(state, this.d.policy));
      const action = planNextAction(state, this.d.policy, done);
      if (!action) return;
      const key = actionKey(action);
      done.add(key);
      report.actions.push({ key, outcome: await this.d.executor.execute(action) });
    }
  }
}
