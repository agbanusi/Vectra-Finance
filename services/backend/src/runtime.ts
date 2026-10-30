import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Address, PublicClient } from "viem";
import type { Deployment } from "@vectra/sdk";
import { loadConfig, loadDeployment, type Config } from "./config.js";
import { openDatabase, type Db } from "./db/database.js";
import { migrate } from "./db/migrations.js";
import { listIndexRows } from "./db/derived.js";
import { makePublicClient } from "./chain/clients.js";
import { createLogger, errorMessage, type Logger } from "./util/log.js";

export interface Runtime {
  config: Config;
  deployment: Deployment;
  db: Db;
  client: PublicClient;
  logger: Logger;
}

/** Loads and validates everything a process needs; migrations are applied on every start. */
export function bootstrap(service: string, env: NodeJS.ProcessEnv = process.env): Runtime {
  const config = loadConfig(env);
  const logger = createLogger({ level: config.logLevel, base: { service } });
  const deployment = loadDeployment(config);
  const db = openDatabase(config.databasePath);
  const applied = migrate(db);
  if (applied.length > 0) logger.info("migrations applied", { versions: applied });
  return { config, deployment, db, client: makePublicClient(config.chainId, config.rpcUrl), logger };
}

export function indexAddresses(db: Db, chainId: number, deployment: Deployment): Address[] {
  const fromDb = listIndexRows(db, chainId).map((r) => r.address as Address);
  return [...new Set([...fromDb, ...(deployment.indexes ?? [])])];
}

export function instanceId(service: string): string {
  return `${service}@${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

/** Runs `step` every `intervalMs` until SIGINT/SIGTERM; a failing step is logged, never fatal. */
export async function runLoop(name: string, intervalMs: number, logger: Logger, step: () => Promise<void>): Promise<void> {
  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  while (!stopping) {
    try {
      await step();
    } catch (err) {
      logger.error(`${name} step failed`, { err: errorMessage(err) });
    }
    if (stopping) break;
    // The timer must stay ref'd: it is what keeps a long-running service process alive between
    // steps. Shutdown clears it via `wake`.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
  logger.info(`${name} stopped`);
}

export function fatal(logger: Logger | undefined, err: unknown): never {
  const msg = errorMessage(err);
  if (logger) logger.error("fatal", { err: msg });
  else process.stderr.write(JSON.stringify({ level: "error", msg: "fatal", err: msg }) + "\n");
  process.exit(1);
}
