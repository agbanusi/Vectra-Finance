import { beforeEach, describe, expect, it } from "vitest";
import { RequestStatus } from "@vectra/sdk";
import { createApp } from "../src/api/app.js";
import { upsertIndex, upsertRequest } from "../src/db/derived.js";
import { setCursor } from "../src/db/chain.js";
import { silentLogger } from "../src/util/log.js";
import type { Db } from "../src/db/database.js";
import { ALICE, BOB, CHAIN_ID, FakeReader, VAULT, indexView, memDb } from "./helpers.js";

const TOKEN = "test-admin-token-0123456789abcdef";

function setup(opts: { burst?: number; reader?: FakeReader } = {}) {
  const db = memDb();
  const reader = opts.reader ?? new FakeReader();
  upsertIndex(db, CHAIN_ID, { address: VAULT, curator: ALICE, baseAsset: BOB, name: "T", symbol: "vTST", complianceModule: BOB, createdBlock: 1, createdTx: "0x1" });
  const { app } = createApp({
    db,
    reader,
    chainId: CHAIN_ID,
    deployment: { indexes: [] },
    logger: silentLogger,
    clientIp: (c) => c.req.header("x-test-ip") ?? "1.1.1.1",
    options: {
      corsOrigins: ["http://localhost:3000"],
      rateLimitPerMinute: 60,
      rateLimitBurst: opts.burst ?? 100,
      trustProxy: false,
      adminToken: TOKEN,
      healthMaxLagBlocks: 10,
      rpcTimeoutMs: 500,
    },
  });
  return { app, db, reader };
}

describe("api", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("lists indexes with bigints as decimal strings and metadata merged", async () => {
    ctx.reader.views.set(VAULT, indexView({ nav: 123_456_789_012_345_678_901n }));
    const res = await ctx.app.request("/v1/indexes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { vault: string; nav: string; metadata: unknown; adapters: { kindName: string }[] }[] };
    expect(body.data[0]).toMatchObject({ vault: VAULT, nav: "123456789012345678901", metadata: null });
    expect(body.data[0]?.adapters[0]?.kindName).toBe("ERC4626");
  });

  it("validates addresses and query params with a structured error", async () => {
    const res = await ctx.app.request("/v1/indexes/not-an-address");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "bad_request", message: "address must be a 20-byte hex address" } });
    expect((await ctx.app.request(`/v1/indexes/${VAULT}/requests?status=bogus`)).status).toBe(400);
    expect((await ctx.app.request(`/v1/indexes/${VAULT}/activity?limit=99999`)).status).toBe(400);
    expect((await ctx.app.request(`/v1/indexes/${VAULT}/history?from=10&to=5`)).status).toBe(400);
  });

  it("returns 404 for unknown indexes and routes", async () => {
    const res = await ctx.app.request(`/v1/indexes/${ALICE}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
    expect((await ctx.app.request("/nope")).status).toBe(404);
  });

  it("returns only real snapshots for history (empty when none)", async () => {
    const res = await ctx.app.request(`/v1/indexes/${VAULT}/history`);
    expect(await res.json()).toEqual({ data: [] });
  });

  it("rate limits per IP with 429 and Retry-After", async () => {
    const { app } = setup({ burst: 2 });
    expect((await app.request("/v1/keeper/status")).status).toBe(200);
    expect((await app.request("/v1/keeper/status")).status).toBe(200);
    const limited = await app.request("/v1/keeper/status");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect((await app.request("/v1/keeper/status", { headers: { "x-test-ip": "2.2.2.2" } })).status).toBe(200);
  });

  it("requires the bearer token for admin metadata and validates the body", async () => {
    const url = `/v1/admin/indexes/${VAULT}/metadata`;
    const body = JSON.stringify({ description: "Blend", category: "lending", riskTier: "low", tags: ["usdc"] });
    const headers = { "content-type": "application/json" };
    expect((await ctx.app.request(url, { method: "PUT", body, headers })).status).toBe(401);
    expect((await ctx.app.request(url, { method: "PUT", body, headers: { ...headers, authorization: "Bearer wrong" } })).status).toBe(401);
    const auth = { ...headers, authorization: `Bearer ${TOKEN}` };
    expect((await ctx.app.request(url, { method: "PUT", body: JSON.stringify({ riskTier: "extreme" }), headers: auth })).status).toBe(400);
    expect((await ctx.app.request(url, { method: "PUT", body: "{not json", headers: auth })).status).toBe(400);
    expect((await ctx.app.request(url, { method: "PUT", body: JSON.stringify({ evil: 1 }), headers: auth })).status).toBe(400);
    const ok = await ctx.app.request(url, { method: "PUT", body, headers: auth });
    expect(ok.status).toBe(200);
    const list = (await (await ctx.app.request("/v1/indexes")).json()) as { data: { metadata: { riskTier: string } }[] };
    expect(list.data[0]?.metadata.riskTier).toBe("low");
  });

  it("portfolio verifies cached open requests against chain and drops stale ones", async () => {
    const base = { indexAddress: VAULT, owner: ALICE, receiver: ALICE, initialShares: "10", remainingShares: "10", minAssetsOut: "0", assetsPaid: "0", status: RequestStatus.Pending, expiresAt: 9, requestedAt: 1, requestedBlock: 1, updatedBlock: 1, txHash: "0x" };
    upsertRequest(ctx.db, CHAIN_ID, { ...base, requestId: 0 });
    upsertRequest(ctx.db, CHAIN_ID, { ...base, requestId: 1 });
    const req = { owner: ALICE, receiver: ALICE, shares: 10n, minAssetsOut: 0n, requestedAt: 1n, expiresAt: 9n, assetsPaid: 0n };
    ctx.reader.requests.set(`${VAULT}:0`, { ...req, status: RequestStatus.Pending });
    ctx.reader.requests.set(`${VAULT}:1`, { ...req, status: RequestStatus.Fulfilled });
    ctx.reader.users.set(`${VAULT}:${ALICE}`, { shares: 5n, value: 6n, baseBalance: 0n, baseAllowance: 0n });
    const body = (await (await ctx.app.request(`/v1/portfolio/${ALICE}`)).json()) as { data: { positions: unknown[]; openRequests: { requestId: number }[] } };
    expect(body.data.positions).toEqual([{ index: VAULT, symbol: "vTST", shares: "5", value: "6" }]);
    expect(body.data.openRequests.map((r) => r.requestId)).toEqual([0]);
  });

  it("health reports degraded when rpc fails or lag is too high", async () => {
    setCursor(ctx.db, CHAIN_ID, { blockNumber: 95, blockHash: "0x" });
    expect((await ctx.app.request("/health")).status).toBe(200);
    ctx.reader.fail = true;
    const res = await ctx.app.request("/health");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { rpc: string }).rpc).toBe("rpc down");
  });

  it("exposes prometheus metrics and CORS headers", async () => {
    await ctx.app.request("/v1/indexes");
    const text = await (await ctx.app.request("/metrics")).text();
    expect(text).toContain("vectra_http_requests_total");
    expect(text).toContain("vectra_dead_letters_open 0");
    const res = await ctx.app.request("/v1/indexes", { headers: { origin: "http://localhost:3000" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});
