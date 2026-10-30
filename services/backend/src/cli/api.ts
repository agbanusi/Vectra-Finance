import { serve } from "@hono/node-server";
import { createApp } from "../api/app.js";
import { viemProtocolReader } from "../chain/reader.js";
import { bootstrap, fatal } from "../runtime.js";

const RPC_HEALTH_TIMEOUT_MS = 3_000;

const rt = (() => {
  try {
    return bootstrap("api");
  } catch (err) {
    return fatal(undefined, err);
  }
})();

const { config, deployment, db, client, logger } = rt;
const { app } = createApp({
  db,
  reader: viemProtocolReader(client, deployment.lens),
  chainId: config.chainId,
  deployment,
  logger,
  options: {
    corsOrigins: config.api.corsOrigins,
    rateLimitPerMinute: config.api.rateLimitPerMinute,
    rateLimitBurst: config.api.rateLimitBurst,
    trustProxy: config.api.trustProxy,
    adminToken: config.api.adminToken,
    healthMaxLagBlocks: config.api.healthMaxLagBlocks,
    rpcTimeoutMs: RPC_HEALTH_TIMEOUT_MS,
  },
});
if (!config.api.adminToken) logger.warn("ADMIN_API_TOKEN not set: admin endpoints disabled");

const server = serve({ fetch: app.fetch, hostname: config.api.host, port: config.api.port }, (info) =>
  logger.info("api listening", { host: info.address, port: info.port }),
);
const shutdown = () => server.close(() => db.close());
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
