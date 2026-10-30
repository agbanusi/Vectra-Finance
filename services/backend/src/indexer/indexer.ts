import { getAddress, type Address } from "viem";
import type { Db } from "../db/database.js";
import { transaction } from "../db/database.js";
import { blocksDescending, deleteAbove, getCursor, pruneBlocks, putBlock, setCursor, type Cursor } from "../db/chain.js";
import { insertEvent } from "../db/events.js";
import { listIndexRows } from "../db/derived.js";
import type { BlockHeader, ChainSource, RawLog } from "../chain/source.js";
import type { Logger } from "../util/log.js";
import { decodeLog } from "./decode.js";
import { applyEvent, rebuildDerivedUnsafe } from "./derive.js";

export interface IndexerOptions {
  db: Db;
  source: ChainSource;
  chainId: number;
  factory: Address;
  startBlock: number;
  confirmations: number;
  batchBlocks: number;
  reorgWindowBlocks: number;
  logger: Logger;
}

export type TickResult =
  | { status: "idle"; safeHead: number; cursor: number | undefined }
  | { status: "ingested"; fromBlock: number; toBlock: number; events: number; safeHead: number }
  | { status: "reorg"; rewoundTo: number };

/** The chain changed under a batch while it was being read; retry on the next tick. */
export class InconsistentBatchError extends Error {}
/** No stored block in the reorg window matches the chain: needs operator intervention (rebuild). */
export class DeepReorgError extends Error {}

export class Indexer {
  constructor(private readonly o: IndexerOptions) {}

  /** One bounded step: detect reorgs, then ingest at most `batchBlocks` confirmed blocks. */
  async tick(): Promise<TickResult> {
    const { o } = this;
    const head = await o.source.getHeadNumber();
    const safeHead = head - o.confirmations;
    const cursor = getCursor(o.db, o.chainId);
    const fromBlock = cursor ? cursor.blockNumber + 1 : o.startBlock;

    if (cursor && (await this.cursorReorged(cursor, fromBlock, safeHead))) {
      const rewoundTo = await this.rewind(cursor.blockNumber);
      return { status: "reorg", rewoundTo };
    }
    if (fromBlock > safeHead) return { status: "idle", safeHead, cursor: cursor?.blockNumber };

    const toBlock = Math.min(safeHead, fromBlock + o.batchBlocks - 1);
    const events = await this.ingestRange(fromBlock, toBlock);
    return { status: "ingested", fromBlock, toBlock, events, safeHead };
  }

  /** Runs ticks until caught up with the confirmed head (or a reorg is handled). */
  async catchUp(maxTicks = Number.MAX_SAFE_INTEGER): Promise<TickResult[]> {
    const results: TickResult[] = [];
    for (let i = 0; i < maxTicks; i++) {
      const r = await this.tick();
      results.push(r);
      if (r.status === "idle") break;
    }
    return results;
  }

  /** Parent-hash check on the next block when there is one; otherwise re-verify the cursor block. */
  private async cursorReorged(cursor: Cursor, fromBlock: number, safeHead: number): Promise<boolean> {
    if (fromBlock <= safeHead) {
      const next = await this.o.source.getBlock(fromBlock);
      return next.parentHash !== cursor.blockHash;
    }
    const current = await this.o.source.getBlock(cursor.blockNumber);
    return current.hash !== cursor.blockHash;
  }

  private async findCommonAncestor(fromBlock: number): Promise<number> {
    const { o } = this;
    for (const stored of blocksDescending(o.db, o.chainId, fromBlock)) {
      const onChain = await o.source.getBlock(stored.blockNumber);
      if (onChain.hash === stored.blockHash) return stored.blockNumber;
    }
    throw new DeepReorgError(`no common ancestor within the stored window below block ${fromBlock}; run rebuild`);
  }

  /** Rewinds to the common ancestor, dropping raw data above it and re-deriving state. */
  async rewind(fromBlock: number): Promise<number> {
    const { o } = this;
    const ancestor = await this.findCommonAncestor(fromBlock);
    const ancestorBlock = blocksDescending(o.db, o.chainId, ancestor)[0];
    if (!ancestorBlock) throw new DeepReorgError(`ancestor ${ancestor} not stored`);
    transaction(o.db, () => {
      deleteAbove(o.db, o.chainId, ancestor);
      rebuildDerivedUnsafe(o.db, o.chainId);
      setCursor(o.db, o.chainId, { blockNumber: ancestor, blockHash: ancestorBlock.blockHash });
    });
    o.logger.warn("reorg handled", { from: fromBlock, ancestor });
    return ancestor;
  }

  private async fetchLogs(fromBlock: number, toBlock: number): Promise<RawLog[]> {
    const { o } = this;
    const factoryLogs = await o.source.getLogs({ addresses: [o.factory], fromBlock, toBlock });
    const known = listIndexRows(o.db, o.chainId).map((r) => getAddress(r.address));
    const created = factoryLogs
      .map((l) => decodeLog(l))
      .filter((d) => d.eventName === "IndexCreated")
      .map((d) => getAddress(String(d.args.vault)));
    const vaults = [...new Set([...known, ...created])];
    const vaultLogs = await o.source.getLogs({ addresses: vaults, fromBlock, toBlock });
    return [...factoryLogs, ...vaultLogs].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  }

  /** Fetches headers for every block we persist and checks the logs belong to the same fork. */
  private async fetchHeaders(logs: RawLog[], fromBlock: number, toBlock: number): Promise<Map<number, BlockHeader>> {
    const numbers = new Set([fromBlock, toBlock, ...logs.map((l) => l.blockNumber)]);
    const headers = new Map<number, BlockHeader>();
    for (const n of numbers) headers.set(n, await this.o.source.getBlock(n));
    for (const log of logs) {
      if (headers.get(log.blockNumber)?.hash !== log.blockHash) {
        throw new InconsistentBatchError(`block ${log.blockNumber} changed while reading the batch`);
      }
    }
    return headers;
  }

  private async ingestRange(fromBlock: number, toBlock: number): Promise<number> {
    const { o } = this;
    const logs = await this.fetchLogs(fromBlock, toBlock);
    const headers = await this.fetchHeaders(logs, fromBlock, toBlock);
    const toHeader = headers.get(toBlock) as BlockHeader;

    return transaction(o.db, () => {
      let inserted = 0;
      for (const log of logs) {
        const header = headers.get(log.blockNumber) as BlockHeader;
        const { eventName, args } = decodeLog(log);
        const stored = insertEvent(o.db, {
          chainId: o.chainId,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          blockTimestamp: header.timestamp,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          address: getAddress(log.address),
          eventName,
          args,
          topics: log.topics,
          data: log.data,
        });
        if (!stored) continue;
        applyEvent(o.db, stored);
        inserted++;
      }
      for (const h of headers.values()) {
        putBlock(o.db, o.chainId, { blockNumber: h.number, blockHash: h.hash, parentHash: h.parentHash, timestamp: h.timestamp });
      }
      setCursor(o.db, o.chainId, { blockNumber: toBlock, blockHash: toHeader.hash });
      pruneBlocks(o.db, o.chainId, toBlock - o.reorgWindowBlocks);
      return inserted;
    });
  }
}
