import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWalletClient, erc20Abi, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { indexVaultAbi, parseDeployment, RequestStatus, type Deployment } from "@vectra/sdk";
import { openDatabase, type Db } from "../src/db/database.js";
import { migrate } from "../src/db/migrations.js";
import { chainFor, makePublicClient } from "../src/chain/clients.js";
import { viemChainSource } from "../src/chain/source.js";
import { viemProtocolReader } from "../src/chain/reader.js";
import { Indexer } from "../src/indexer/indexer.js";
import { takeSnapshots } from "../src/indexer/snapshots.js";
import { createApp } from "../src/api/app.js";
import { Executor } from "../src/keeper/executor.js";
import { viemTxBackend } from "../src/keeper/backend.js";
import { Keeper } from "../src/keeper/keeper.js";
import { AlertNotifier } from "../src/keeper/alerts.js";
import { silentLogger } from "../src/util/log.js";
import { POLICY } from "./helpers.js";

// Anvil's well-known PUBLIC development keys. Never use them anywhere else.
const ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KEEPER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex; // account #1
const USER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex; // account #2
const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 31337;
const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const DEPLOYMENT_PATH = join(REPO_ROOT, "deployments", "31337.json");
const DEPOSIT = 100_000n * 10n ** 6n;

const hasAnvil = spawnSync("anvil", ["--version"]).status === 0 && spawnSync("forge", ["--version"]).status === 0;
if (!hasAnvil) console.warn("[integration] anvil/forge not on PATH: skipping integration test");

async function waitForRpc(client: PublicClient): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      await client.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("anvil did not start");
}

describe.skipIf(!hasAnvil)("integration (anvil + LocalDemo)", () => {
  let anvil: ChildProcess | undefined;
  let backup: string | undefined;
  let tmp: string;
  let db: Db;
  let client: PublicClient;
  let deployment: Deployment;
  let indexer: Indexer;

  beforeAll(async () => {
    if (spawnSync("lsof", [`-iTCP:${PORT}`, "-sTCP:LISTEN"]).stdout.length > 0) throw new Error(`port ${PORT} is already in use`);
    backup = existsSync(DEPLOYMENT_PATH) ? readFileSync(DEPLOYMENT_PATH, "utf8") : undefined;
    anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    client = makePublicClient(CHAIN_ID, RPC);
    await waitForRpc(client);
    try {
      execFileSync("forge", ["script", "script/LocalDemo.s.sol", "--rpc-url", RPC, "--private-key", ANVIL_KEY_0, "--broadcast"], {
        cwd: REPO_ROOT,
        stdio: "ignore",
      });
      deployment = parseDeployment(JSON.parse(readFileSync(DEPLOYMENT_PATH, "utf8")));
    } finally {
      if (backup !== undefined) writeFileSync(DEPLOYMENT_PATH, backup);
    }
    tmp = mkdtempSync(join(tmpdir(), "vectra-backend-it-"));
    db = openDatabase(join(tmp, "it.db"));
    migrate(db);
    indexer = new Indexer({
      db,
      source: viemChainSource(client),
      chainId: CHAIN_ID,
      factory: deployment.factory,
      startBlock: deployment.startBlock,
      confirmations: 0,
      batchBlocks: 500,
      reorgWindowBlocks: 64,
      logger: silentLogger,
    });
  });

  afterAll(() => {
    anvil?.kill("SIGKILL");
    db?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    if (backup !== undefined) writeFileSync(DEPLOYMENT_PATH, backup);
  });

  it("indexes the demo, serves NAV matching the lens, and the keeper fulfils a queued redemption", async () => {
    await indexer.catchUp();
    const reader = viemProtocolReader(client, deployment.lens);
    expect(await takeSnapshots(db, reader, CHAIN_ID)).toBe(3);

    const { app } = createApp({
      db,
      reader,
      chainId: CHAIN_ID,
      deployment: { indexes: [] }, // only what the indexer discovered
      logger: silentLogger,
      options: { corsOrigins: [], rateLimitPerMinute: 600, rateLimitBurst: 100, trustProxy: false, adminToken: undefined, healthMaxLagBlocks: 10, rpcTimeoutMs: 2_000 },
    });
    const listed = (await (await app.request("/v1/indexes")).json()) as { data: { vault: Address; nav: string }[] };
    expect(listed.data.map((d) => d.vault).sort()).toEqual([...(deployment.indexes ?? [])].sort());
    const lensViews = await reader.getIndexes(listed.data.map((d) => d.vault));
    expect(listed.data.map((d) => d.nav)).toEqual(lensViews.map((v) => v.nav.toString()));

    // User deposits, then redeems everything: larger than free liquidity, so it is queued.
    const vault = deployment.indexes?.[0] as Address;
    const user = privateKeyToAccount(USER_KEY);
    const wallet = createWalletClient({ account: user, chain: chainFor(CHAIN_ID, RPC), transport: http(RPC) });
    const send = async (hash: Promise<Hex>) => expect((await client.waitForTransactionReceipt({ hash: await hash })).status).toBe("success");
    await send(wallet.writeContract({ address: deployment.baseAsset as Address, abi: erc20Abi, functionName: "approve", args: [vault, DEPOSIT] }));
    await send(wallet.writeContract({ address: vault, abi: indexVaultAbi, functionName: "deposit", args: [DEPOSIT, 0n, user.address] }));
    const shares = await client.readContract({ address: vault, abi: indexVaultAbi, functionName: "balanceOf", args: [user.address] });
    const sim = await client.simulateContract({ account: user, address: vault, abi: indexVaultAbi, functionName: "redeem", args: [shares, 0n, true, user.address] });
    const [instant, requestId] = sim.result;
    expect(instant).toBe(0n);
    await send(wallet.writeContract(sim.request));
    const queued = await reader.getRequest(vault, requestId);
    expect(queued.status).toBe(RequestStatus.Pending);

    // One keeper tick with the KEEPER-role account.
    const notifier = new AlertNotifier(silentLogger, { webhookUrl: undefined, cooldownMs: 0 });
    const executor = new Executor({
      db,
      backend: viemTxBackend({ publicClient: client, chainId: CHAIN_ID, rpcUrl: RPC, privateKey: KEEPER_KEY }),
      chainId: CHAIN_ID,
      instanceId: "it",
      leaseTtlMs: 60_000,
      maxFeePerGasWei: 10n ** 12n,
      retry: { maxAttempts: 2, baseDelayMs: 50, maxDelayMs: 100 },
      logger: silentLogger,
      onAlert: async (a) => void (await notifier.notify([a])),
    });
    const keeper = new Keeper({ reader, executor, notifier, policy: { ...POLICY, enableDrift: false }, logger: silentLogger, indexes: () => [vault] });
    const [report] = await keeper.tick();
    expect(report?.error).toBeUndefined();
    expect(report?.actions.map((a) => [a.key.split(":")[1], a.outcome.status])).toEqual([
      ["rebalance", "success"],
      ["processRedemptions", "success"],
    ]);

    expect((await reader.getRequest(vault, requestId)).status).toBe(RequestStatus.Fulfilled);
    await indexer.catchUp();
    const res = (await (await app.request(`/v1/indexes/${vault}/requests?status=fulfilled`)).json()) as { data: { requestId: number; owner: string }[] };
    expect(res.data).toEqual([expect.objectContaining({ requestId: Number(requestId), owner: user.address })]);
    const activity = (await (await app.request(`/v1/activity/${user.address}`)).json()) as { data: { kind: string }[] };
    expect(activity.data.map((a) => a.kind)).toEqual(["redemption_filled", "redemption_requested", "deposit"]);
  }, 120_000);
});
