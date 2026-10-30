import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isHex, type Hex } from "viem";
import { parseDeployment, type Deployment } from "@vectra/sdk";
import type { LogLevel } from "./util/log.js";

/** Typed, validated runtime configuration. Secrets are kept here and never logged. */
export interface KeeperPolicy {
  enableProcess: boolean;
  enableRebalance: boolean;
  enableDrift: boolean;
  enableExpire: boolean;
  driftThresholdBps: number;
  rebalanceThresholdBps: number;
  processMaxRequests: number;
  rebalanceMaxActions: number;
  maxActionsPerIndexTick: number;
  queueAgeAlertSeconds: number;
}

export interface Config {
  rpcUrl: string;
  chainId: number;
  deploymentFile: string;
  databasePath: string;
  logLevel: LogLevel;
  api: {
    host: string;
    port: number;
    adminToken: string | undefined;
    corsOrigins: string[];
    rateLimitPerMinute: number;
    rateLimitBurst: number;
    trustProxy: boolean;
    healthMaxLagBlocks: number;
  };
  indexer: {
    confirmations: number;
    pollMs: number;
    batchBlocks: number;
    reorgWindowBlocks: number;
    snapshotIntervalMs: number;
  };
  keeper: {
    privateKey: Hex | undefined;
    pollMs: number;
    maxFeePerGasWei: bigint;
    retryMaxAttempts: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
    leaseTtlMs: number;
    alertWebhookUrl: string | undefined;
    alertCooldownMs: number;
    policy: KeeperPolicy;
  };
}

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];
const MIN_ADMIN_TOKEN_LENGTH = 24;
const PRIVATE_KEY_HEX_LENGTH = 66;
const MAX_BPS = 10_000;

function str(env: Env, key: string, fallback?: string): string {
  const value = env[key]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new ConfigError(`${key} is required`);
}

function optional(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function int(env: Env, key: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = optional(env, key);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${key} must be a non-negative integer`);
  const value = Number(raw);
  if (value < min || value > max) throw new ConfigError(`${key} must be between ${min} and ${max}`);
  return value;
}

function requiredInt(env: Env, key: string): number {
  str(env, key);
  return int(env, key, 0, 1);
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = optional(env, key)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new ConfigError(`${key} must be true or false`);
}

function bigintVar(env: Env, key: string, fallback: bigint): bigint {
  const raw = optional(env, key);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${key} must be a non-negative integer (wei)`);
  return BigInt(raw);
}

function url(env: Env, key: string, value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(`${key} must be a valid URL`);
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) throw new ConfigError(`${key} has an unsupported scheme`);
  return value;
}

function privateKey(env: Env): Hex | undefined {
  const raw = optional(env, "KEEPER_PRIVATE_KEY");
  if (raw === undefined) return undefined;
  if (!isHex(raw) || raw.length !== PRIVATE_KEY_HEX_LENGTH) {
    throw new ConfigError("KEEPER_PRIVATE_KEY must be a 32-byte 0x-prefixed hex string");
  }
  return raw;
}

function adminToken(env: Env): string | undefined {
  const raw = optional(env, "ADMIN_API_TOKEN");
  if (raw !== undefined && raw.length < MIN_ADMIN_TOKEN_LENGTH) {
    throw new ConfigError(`ADMIN_API_TOKEN must be at least ${MIN_ADMIN_TOKEN_LENGTH} characters`);
  }
  return raw;
}

function logLevel(env: Env): LogLevel {
  const raw = str(env, "LOG_LEVEL", "info") as LogLevel;
  if (!LOG_LEVELS.includes(raw)) throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}`);
  return raw;
}

function policy(env: Env): KeeperPolicy {
  return {
    enableProcess: bool(env, "KEEPER_ENABLE_PROCESS", true),
    enableRebalance: bool(env, "KEEPER_ENABLE_REBALANCE", true),
    enableDrift: bool(env, "KEEPER_ENABLE_DRIFT", false),
    enableExpire: bool(env, "KEEPER_ENABLE_EXPIRE", true),
    driftThresholdBps: int(env, "DRIFT_THRESHOLD_BPS", 500, 1, MAX_BPS),
    rebalanceThresholdBps: int(env, "REBALANCE_THRESHOLD_BPS", 100, 0, MAX_BPS),
    processMaxRequests: int(env, "PROCESS_MAX_REQUESTS", 25, 1, 500),
    rebalanceMaxActions: int(env, "REBALANCE_MAX_ACTIONS", 8, 1, 64),
    maxActionsPerIndexTick: int(env, "KEEPER_MAX_ACTIONS_PER_INDEX_TICK", 4, 1, 32),
    queueAgeAlertSeconds: int(env, "QUEUE_AGE_ALERT_SECONDS", 86_400, 60),
  };
}

export function loadConfig(env: Env = process.env): Config {
  const webhook = optional(env, "ALERT_WEBHOOK_URL");
  return {
    rpcUrl: url(env, "RPC_URL", str(env, "RPC_URL")),
    chainId: requiredInt(env, "CHAIN_ID"),
    deploymentFile: resolve(str(env, "DEPLOYMENT_FILE")),
    databasePath: str(env, "DATABASE_PATH", "./data/vectra.db"),
    logLevel: logLevel(env),
    api: {
      host: str(env, "API_HOST", "0.0.0.0"),
      port: int(env, "API_PORT", 8787, 1, 65_535),
      adminToken: adminToken(env),
      corsOrigins: str(env, "CORS_ORIGINS", "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean),
      rateLimitPerMinute: int(env, "RATE_LIMIT_PER_MINUTE", 120, 1),
      rateLimitBurst: int(env, "RATE_LIMIT_BURST", 30, 1),
      trustProxy: bool(env, "TRUST_PROXY", false),
      healthMaxLagBlocks: int(env, "HEALTH_MAX_LAG_BLOCKS", 50, 1),
    },
    indexer: {
      confirmations: int(env, "CONFIRMATIONS", 2, 0, 1_000),
      pollMs: int(env, "INDEXER_POLL_MS", 4_000, 100),
      batchBlocks: int(env, "INDEXER_BATCH_BLOCKS", 2_000, 1, 100_000),
      reorgWindowBlocks: int(env, "REORG_WINDOW_BLOCKS", 256, 8, 10_000),
      snapshotIntervalMs: int(env, "SNAPSHOT_INTERVAL_MS", 60_000, 1_000),
    },
    keeper: {
      privateKey: privateKey(env),
      pollMs: int(env, "KEEPER_POLL_MS", 30_000, 1_000),
      maxFeePerGasWei: bigintVar(env, "KEEPER_MAX_FEE_PER_GAS_WEI", 100_000_000_000n),
      retryMaxAttempts: int(env, "RETRY_MAX_ATTEMPTS", 4, 1, 20),
      retryBaseDelayMs: int(env, "RETRY_BASE_DELAY_MS", 1_000, 1),
      retryMaxDelayMs: int(env, "RETRY_MAX_DELAY_MS", 30_000, 1),
      leaseTtlMs: int(env, "LEASE_TTL_MS", 120_000, 1_000),
      alertWebhookUrl: webhook === undefined ? undefined : url(env, "ALERT_WEBHOOK_URL", webhook),
      alertCooldownMs: int(env, "ALERT_COOLDOWN_MS", 900_000, 0),
      policy: policy(env),
    },
  };
}

/** Reads `deployments/<chainId>.json` and checks it targets the configured chain. */
export function loadDeployment(config: Pick<Config, "deploymentFile" | "chainId">): Deployment {
  const raw: unknown = JSON.parse(readFileSync(config.deploymentFile, "utf8"));
  const deployment = parseDeployment(raw);
  if (deployment.chainId !== config.chainId) {
    throw new ConfigError(`deployment chainId ${deployment.chainId} does not match CHAIN_ID ${config.chainId}`);
  }
  return deployment;
}
