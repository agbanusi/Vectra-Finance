import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  toHex,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import { indexFactoryAbi, indexVaultAbi, RequestStatus } from "@vectra/sdk";
import { openDatabase, IN_MEMORY, type Db } from "../src/db/database.js";
import { migrate } from "../src/db/migrations.js";
import type { BlockHeader, ChainSource, RawLog } from "../src/chain/source.js";
import type { IndexView, OnchainRequest, OpenRequest, ProtocolReader, UserView, AdapterView } from "../src/chain/reader.js";
import type { KeeperPolicy } from "../src/config.js";

export const CHAIN_ID = 31337;
export const FACTORY = getAddress("0x00000000000000000000000000000000000fac70");
export const VAULT = getAddress("0x000000000000000000000000000000000000a001");
export const ALICE = getAddress("0x000000000000000000000000000000000000a11c");
export const BOB = getAddress("0x0000000000000000000000000000000000000b0b");
export const ADAPTER_A = getAddress("0x00000000000000000000000000000000000ada01");
export const ADAPTER_B = getAddress("0x00000000000000000000000000000000000ada02");

export function memDb(): Db {
  const db = openDatabase(IN_MEMORY);
  migrate(db);
  return db;
}

/** ABI-encodes a log for an event in the vault or factory ABI. */
export function encodeLog(eventName: string, args: Record<string, unknown>): { topics: Hex[]; data: Hex } {
  const abi = [...indexVaultAbi, ...indexFactoryAbi] as Abi;
  const event = abi.find((i) => i.type === "event" && i.name === eventName) as AbiEvent;
  const topics = encodeEventTopics({ abi: [event], eventName, args: args as never }) as Hex[];
  const dataInputs = event.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(dataInputs, dataInputs.map((i) => args[i.name as string]));
  return { topics, data };
}

export interface LogSpec {
  address: Address;
  event: string;
  args: Record<string, unknown>;
}

/** In-memory chain with forkable history. Block hashes depend on a fork salt so reorgs change them. */
export class FakeChain implements ChainSource {
  blocks: BlockHeader[] = [];
  private logs = new Map<Hex, RawLog[]>();
  private salt = 0;
  calls = { getLogs: 0, getBlock: 0 };

  constructor(genesisCount = 1) {
    for (let i = 0; i < genesisCount; i++) this.mine([]);
  }

  get head(): number {
    return this.blocks.length - 1;
  }

  mine(specs: LogSpec[]): BlockHeader {
    const number = this.blocks.length;
    const parentHash = number === 0 ? (`0x${"00".repeat(32)}` as Hex) : (this.blocks[number - 1] as BlockHeader).hash;
    const hash = keccak256(toHex(`fork${this.salt}:block${number}`));
    const header = { number, hash, parentHash, timestamp: 1_700_000_000 + number * 12 };
    this.blocks.push(header);
    this.logs.set(
      hash,
      specs.map((s, logIndex) => ({
        address: s.address,
        blockNumber: number,
        blockHash: hash,
        logIndex,
        transactionHash: keccak256(toHex(`tx:${hash}:${logIndex}`)),
        ...encodeLog(s.event, s.args),
      })),
    );
    return header;
  }

  mineEmpty(count: number): void {
    for (let i = 0; i < count; i++) this.mine([]);
  }

  /** Drops blocks >= `fromBlock`; subsequent mined blocks belong to a new fork. */
  reorgFrom(fromBlock: number): void {
    this.blocks = this.blocks.slice(0, fromBlock);
    this.salt++;
  }

  async getHeadNumber(): Promise<number> {
    return this.head;
  }

  async getBlock(n: number): Promise<BlockHeader> {
    this.calls.getBlock++;
    const b = this.blocks[n];
    if (!b) throw new Error(`no block ${n}`);
    return b;
  }

  async getLogs(p: { addresses: Address[]; fromBlock: number; toBlock: number }): Promise<RawLog[]> {
    this.calls.getLogs++;
    const wanted = new Set(p.addresses.map((a) => a.toLowerCase()));
    return this.blocks
      .slice(p.fromBlock, p.toBlock + 1)
      .flatMap((b) => this.logs.get(b.hash) ?? [])
      .filter((l) => wanted.has(l.address.toLowerCase()));
  }
}

export const indexCreated = (vault: Address = VAULT): LogSpec => ({
  address: FACTORY,
  event: "IndexCreated",
  args: { vault, curator: ALICE, baseAsset: BOB, name: "Test Index", symbol: "vTST", complianceModule: getAddress("0x0000000000000000000000000000000000000000") },
});
export const deposited = (receiver: Address, assets: bigint, shares: bigint): LogSpec => ({
  address: VAULT,
  event: "Deposited",
  args: { payer: receiver, receiver, assets, shares },
});
export const requested = (requestId: bigint, owner: Address, shares: bigint): LogSpec => ({
  address: VAULT,
  event: "RedemptionRequested",
  args: { requestId, owner, receiver: owner, shares, minAssetsOut: 0n, expiresAt: 1_800_000_000n },
});
export const filled = (requestId: bigint, receiver: Address, sharesBurned: bigint, assetsPaid: bigint): LogSpec => ({
  address: VAULT,
  event: "RedemptionFilled",
  args: { requestId, receiver, sharesBurned, assetsPaid },
});
export const partiallyFilled = (requestId: bigint, receiver: Address, sharesBurned: bigint, assetsPaid: bigint): LogSpec => ({
  address: VAULT,
  event: "RedemptionPartiallyFilled",
  args: { requestId, receiver, sharesBurned, assetsPaid },
});
export const transfer = (from: Address, to: Address, value: bigint): LogSpec => ({
  address: VAULT,
  event: "Transfer",
  args: { from, to, value },
});

export const POLICY: KeeperPolicy = {
  enableProcess: true,
  enableRebalance: true,
  enableDrift: true,
  enableExpire: true,
  driftThresholdBps: 500,
  rebalanceThresholdBps: 100,
  processMaxRequests: 25,
  rebalanceMaxActions: 8,
  maxActionsPerIndexTick: 4,
  queueAgeAlertSeconds: 3_600,
};

export function adapterView(overrides: Partial<AdapterView> = {}): AdapterView {
  return {
    adapter: ADAPTER_A,
    kind: keccak256(toHex("ERC4626")),
    target: BOB,
    targetBps: 10_000,
    enabled: true,
    quarantined: false,
    healthy: true,
    valuationOk: true,
    totalAssets: 900n,
    maxDeposit: 10n ** 30n,
    maxWithdraw: 900n,
    targetAssets: 900n,
    ...overrides,
  };
}

/** A balanced index: NAV 1000, buffer 10% held liquid, one adapter on target. */
export function indexView(overrides: Partial<IndexView> = {}): IndexView {
  return {
    vault: VAULT,
    name: "Test Index",
    symbol: "vTST",
    baseAsset: BOB,
    baseDecimals: 6,
    curator: ALICE,
    compliancePolicy: "permissionless",
    complianceModule: getAddress("0x0000000000000000000000000000000000000000"),
    totalSupply: 1_000n,
    nav: 1_000n,
    navHealthy: true,
    pricePerShare: 10n ** 18n,
    baseBalance: 100n,
    reservedShares: 0n,
    reservedAssets: 0n,
    availableLiquidity: 100n,
    liquidBufferBps: 1_000,
    weightToleranceBps: 300,
    managementFeeBps: 0,
    performanceFeeBps: 0,
    minDeposit: 1n,
    minRedeem: 1n,
    redemptionTtl: 604_800n,
    pendingRequests: 0,
    maxQueueLength: 500,
    headRequestId: 0n,
    nextRequestId: 0n,
    partialFillsEnabled: true,
    depositsPaused: false,
    redemptionsPaused: false,
    shutdown: false,
    configVersion: 1n,
    adapters: [adapterView()],
    ...overrides,
  };
}

export function openRequest(id: bigint, shares: bigint, overrides: Partial<OnchainRequest> = {}): OpenRequest {
  return {
    id,
    request: {
      owner: ALICE,
      receiver: ALICE,
      shares,
      minAssetsOut: 0n,
      requestedAt: 1_000n,
      expiresAt: 1_000_000n,
      assetsPaid: 0n,
      status: RequestStatus.Pending,
      ...overrides,
    },
  };
}

export class FakeReader implements ProtocolReader {
  views = new Map<string, IndexView>();
  users = new Map<string, UserView>();
  requests = new Map<string, OnchainRequest>();
  latest = { number: 100, timestamp: 2_000 };
  fail = false;

  async getLatestBlock() {
    if (this.fail) throw new Error("rpc down");
    return this.latest;
  }
  async getIndexes(vaults: readonly Address[]) {
    return vaults.map((v) => this.views.get(v) ?? indexView({ vault: v }));
  }
  async getUser(vault: Address, user: Address) {
    return this.users.get(`${vault}:${user}`) ?? { shares: 0n, value: 0n, baseBalance: 0n, baseAllowance: 0n };
  }
  async getRequests() {
    return [];
  }
  async getRequest(vault: Address, id: bigint) {
    const r = this.requests.get(`${vault}:${id}`);
    if (!r) throw new Error("unknown request");
    return r;
  }
}
