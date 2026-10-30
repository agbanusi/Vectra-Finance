import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { Deployment } from "@vectra/sdk";
import type { Db } from "../db/database.js";
import { getCursor } from "../db/chain.js";
import { listActivity, listRequests } from "../db/derived.js";
import { listSnapshots } from "../db/snapshots.js";
import { putMetadata } from "../db/metadata.js";
import { countOpenDeadLetters, openDeadLetters, recentRuns } from "../db/jobs.js";
import type { ProtocolReader } from "../chain/reader.js";
import type { Logger } from "../util/log.js";
import { errorMessage } from "../util/log.js";
import { ApiError, type ErrorBody } from "./errors.js";
import { isAuthorized } from "./auth.js";
import { Metrics } from "./metrics.js";
import { TokenBucketLimiter } from "./rateLimit.js";
import { getIndex, listIndexes, portfolio, requireKnownIndex, type ServiceDeps } from "./service.js";
import { parseAddress, parseIntParam, parseMetadataBody, parseStatusFilter } from "./validate.js";

export interface ApiOptions {
  corsOrigins: string[];
  rateLimitPerMinute: number;
  rateLimitBurst: number;
  trustProxy: boolean;
  adminToken: string | undefined;
  healthMaxLagBlocks: number;
  rpcTimeoutMs: number;
}

export interface AppDeps {
  db: Db;
  reader: ProtocolReader;
  chainId: number;
  deployment: Pick<Deployment, "indexes">;
  options: ApiOptions;
  logger: Logger;
  now?: () => number;
  /** Override for tests; defaults to the socket address (or X-Forwarded-For when trusted). */
  clientIp?: (c: Context) => string;
}

const MAX_PAGE = 500;
const DEFAULT_PAGE = 100;
const MAX_HISTORY = 5_000;
const KEEPER_STATUS_LIMIT = 50;

function defaultClientIp(trustProxy: boolean): (c: Context) => string {
  return (c) => {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (trustProxy && forwarded) return forwarded;
    const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
    return incoming?.socket?.remoteAddress ?? "unknown";
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms).unref()),
  ]);
}

function page(c: Context): { limit: number; offset: number } {
  return {
    limit: parseIntParam(c.req.query("limit"), "limit", { min: 1, max: MAX_PAGE, fallback: DEFAULT_PAGE }),
    offset: parseIntParam(c.req.query("offset"), "offset", { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 }),
  };
}

export function createApp(deps: AppDeps): { app: Hono; metrics: Metrics } {
  const app = new Hono();
  const metrics = new Metrics();
  const now = deps.now ?? Date.now;
  const clientIp = deps.clientIp ?? defaultClientIp(deps.options.trustProxy);
  const limiter = new TokenBucketLimiter(deps.options.rateLimitBurst, deps.options.rateLimitPerMinute);
  const svc: ServiceDeps = { db: deps.db, reader: deps.reader, chainId: deps.chainId, deployment: deps.deployment };

  app.use("*", async (c, next) => {
    const started = now();
    await next();
    const route = c.req.routePath;
    metrics.inc("vectra_http_requests_total", "HTTP requests", { route, method: c.req.method, status: c.res.status });
    deps.logger.info("request", { method: c.req.method, path: c.req.path, status: c.res.status, ms: now() - started });
  });
  app.use("*", cors({ origin: deps.options.corsOrigins, allowMethods: ["GET", "PUT", "OPTIONS"], maxAge: 600 }));
  app.use("/v1/*", async (c, next) => {
    const decision = limiter.take(clientIp(c), now());
    if (!decision.allowed) {
      c.header("Retry-After", String(decision.retryAfterSeconds));
      throw new ApiError(429, "rate_limited", "too many requests");
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.body(), err.status);
    deps.logger.error("unhandled api error", { path: c.req.path, err: errorMessage(err) });
    const body: ErrorBody = { error: { code: "internal", message: "internal error" } };
    return c.json(body, 500);
  });
  app.notFound((c) => c.json({ error: { code: "not_found", message: "route not found" } } satisfies ErrorBody, 404));

  app.get("/health", async (c) => {
    const cursor = getCursor(deps.db, deps.chainId);
    deps.db.prepare("SELECT 1").get();
    let head: number | null = null;
    let rpcError: string | null = null;
    try {
      head = (await withTimeout(deps.reader.getLatestBlock(), deps.options.rpcTimeoutMs)).number;
    } catch (err) {
      rpcError = errorMessage(err);
    }
    const lag = head !== null && cursor ? head - cursor.blockNumber : null;
    const healthy = rpcError === null && lag !== null && lag <= deps.options.healthMaxLagBlocks;
    const body = { status: healthy ? "ok" : "degraded", db: "ok", rpc: rpcError ?? "ok", head, indexedBlock: cursor?.blockNumber ?? null, lagBlocks: lag };
    return c.json(body, healthy ? 200 : 503);
  });

  app.get("/metrics", (c) => {
    const cursor = getCursor(deps.db, deps.chainId);
    const text = metrics.render([
      { name: "vectra_indexed_block", help: "Last indexed (confirmed) block", samples: [{ labels: {}, value: cursor?.blockNumber ?? -1 }] },
      { name: "vectra_dead_letters_open", help: "Unresolved keeper dead letters", samples: [{ labels: {}, value: countOpenDeadLetters(deps.db) }] },
    ]);
    return c.text(text, 200, { "content-type": "text/plain; version=0.0.4" });
  });

  app.get("/v1/indexes", async (c) => c.json({ data: await listIndexes(svc) }));

  app.get("/v1/indexes/:address", async (c) => {
    return c.json({ data: await getIndex(svc, parseAddress(c.req.param("address"), "address")) });
  });

  app.get("/v1/indexes/:address/history", (c) => {
    const address = parseAddress(c.req.param("address"), "address");
    requireKnownIndex(svc, address);
    const nowSec = Math.floor(now() / 1000);
    const from = parseIntParam(c.req.query("from"), "from", { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
    const to = parseIntParam(c.req.query("to"), "to", { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: nowSec });
    const limit = parseIntParam(c.req.query("limit"), "limit", { min: 1, max: MAX_HISTORY, fallback: 1_000 });
    if (from > to) throw new ApiError(400, "bad_request", "from must be <= to");
    return c.json({ data: listSnapshots(deps.db, deps.chainId, address, { from, to, limit }) });
  });

  app.get("/v1/indexes/:address/requests", (c) => {
    const address = parseAddress(c.req.param("address"), "address");
    const statuses = parseStatusFilter(c.req.query("status"));
    requireKnownIndex(svc, address);
    return c.json({ data: listRequests(deps.db, deps.chainId, address, statuses) });
  });

  app.get("/v1/indexes/:address/activity", (c) => {
    const address = parseAddress(c.req.param("address"), "address");
    requireKnownIndex(svc, address);
    return c.json({ data: listActivity(deps.db, deps.chainId, { index: address }, page(c)) });
  });

  app.get("/v1/portfolio/:wallet", async (c) => {
    return c.json({ data: await portfolio(svc, parseAddress(c.req.param("wallet"), "wallet")) });
  });

  app.get("/v1/activity/:wallet", (c) => {
    const wallet = parseAddress(c.req.param("wallet"), "wallet");
    return c.json({ data: listActivity(deps.db, deps.chainId, { wallet }, page(c)) });
  });

  app.get("/v1/keeper/status", (c) => {
    return c.json({ data: { runs: recentRuns(deps.db, KEEPER_STATUS_LIMIT), deadLetters: openDeadLetters(deps.db, KEEPER_STATUS_LIMIT) } });
  });

  app.put("/v1/admin/indexes/:address/metadata", async (c) => {
    if (!deps.options.adminToken) throw new ApiError(503, "admin_disabled", "admin API is not configured");
    if (!isAuthorized(c.req.header("authorization"), deps.options.adminToken)) {
      throw new ApiError(401, "unauthorized", "missing or invalid bearer token");
    }
    const address = parseAddress(c.req.param("address"), "address");
    const body = parseMetadataBody(await c.req.json().catch(() => {
      throw new ApiError(400, "bad_request", "body must be valid JSON");
    }));
    requireKnownIndex(svc, address);
    const saved = putMetadata(deps.db, deps.chainId, address, body);
    deps.logger.info("metadata updated", { index: address });
    return c.json({ data: saved });
  });

  return { app, metrics };
}
