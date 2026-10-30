import { beforeEach, describe, expect, it } from "vitest";
import { RequestStatus } from "@vectra/sdk";
import { Indexer, DeepReorgError } from "../src/indexer/indexer.js";
import { rebuildDerived } from "../src/indexer/derive.js";
import { getCursor } from "../src/db/chain.js";
import { countEvents } from "../src/db/events.js";
import { getRequest, listActivity, listIndexRows, snapshotDerived } from "../src/db/derived.js";
import { silentLogger } from "../src/util/log.js";
import type { Db } from "../src/db/database.js";
import {
  ALICE,
  BOB,
  CHAIN_ID,
  FACTORY,
  FakeChain,
  VAULT,
  deposited,
  filled,
  indexCreated,
  memDb,
  partiallyFilled,
  requested,
  transfer,
} from "./helpers.js";

function makeIndexer(db: Db, chain: FakeChain, overrides: Partial<{ confirmations: number; batchBlocks: number; reorgWindowBlocks: number }> = {}) {
  return new Indexer({
    db,
    source: chain,
    chainId: CHAIN_ID,
    factory: FACTORY,
    startBlock: 0,
    confirmations: overrides.confirmations ?? 0,
    batchBlocks: overrides.batchBlocks ?? 5,
    reorgWindowBlocks: overrides.reorgWindowBlocks ?? 64,
    logger: silentLogger,
  });
}

describe("indexer", () => {
  let db: Db;
  let chain: FakeChain;

  beforeEach(() => {
    db = memDb();
    chain = new FakeChain(1);
  });

  it("discovers indexes and ingests vault events created in the same batch", async () => {
    chain.mine([indexCreated(), deposited(ALICE, 1_000n, 1_000n)]);
    chain.mine([requested(0n, ALICE, 400n)]);
    await makeIndexer(db, chain).catchUp();

    expect(listIndexRows(db, CHAIN_ID).map((r) => r.address)).toEqual([VAULT]);
    expect(countEvents(db, CHAIN_ID)).toBe(3);
    expect(getRequest(db, CHAIN_ID, VAULT, 0)?.status).toBe(RequestStatus.Pending);
    expect(getCursor(db, CHAIN_ID)?.blockNumber).toBe(chain.head);
  });

  it("respects confirmations and bounded batches", async () => {
    chain.mine([indexCreated()]);
    chain.mineEmpty(20);
    const indexer = makeIndexer(db, chain, { confirmations: 3, batchBlocks: 4 });
    const first = await indexer.tick();
    expect(first).toMatchObject({ status: "ingested", fromBlock: 0, toBlock: 3 });
    await indexer.catchUp();
    expect(getCursor(db, CHAIN_ID)?.blockNumber).toBe(chain.head - 3);
  });

  it("is idempotent: re-ingesting the same range does not duplicate events or activity", async () => {
    chain.mine([indexCreated(), deposited(ALICE, 1_000n, 1_000n)]);
    const indexer = makeIndexer(db, chain);
    await indexer.catchUp();
    const before = snapshotDerived(db, CHAIN_ID);
    const eventsBefore = countEvents(db, CHAIN_ID);

    // Simulate a crash before the cursor advanced: force the same range to be read again.
    db.prepare("UPDATE chain_cursor SET block_number = 0, block_hash = ? WHERE chain_id = ?").run(chain.blocks[0]?.hash ?? "", CHAIN_ID);
    await indexer.catchUp();

    expect(countEvents(db, CHAIN_ID)).toBe(eventsBefore);
    expect(snapshotDerived(db, CHAIN_ID)).toEqual(before);
  });

  it("detects a parent-hash mismatch, rewinds to the common ancestor and reprocesses the new fork", async () => {
    chain.mine([indexCreated(), deposited(ALICE, 1_000n, 1_000n)]); // 1
    chain.mine([requested(0n, ALICE, 400n)]); // 2
    chain.mine([filled(0n, ALICE, 400n, 400n)]); // 3
    const indexer = makeIndexer(db, chain);
    await indexer.catchUp();
    expect(getRequest(db, CHAIN_ID, VAULT, 0)?.status).toBe(RequestStatus.Fulfilled);

    // Blocks 3.. are replaced: on the new fork the fill never happened, a partial fill did instead.
    chain.reorgFrom(3);
    chain.mine([partiallyFilled(0n, ALICE, 100n, 100n)]);
    chain.mine([]);

    const result = await indexer.tick();
    expect(result).toEqual({ status: "reorg", rewoundTo: 2 });
    await indexer.catchUp();

    const req = getRequest(db, CHAIN_ID, VAULT, 0);
    expect(req?.status).toBe(RequestStatus.PartiallyFilled);
    expect(req?.remainingShares).toBe("300");
    expect(getCursor(db, CHAIN_ID)).toEqual({ blockNumber: chain.head, blockHash: chain.blocks[chain.head]?.hash });
    const kinds = listActivity(db, CHAIN_ID, { wallet: ALICE }, { limit: 50, offset: 0 }).map((a) => a.kind);
    expect(kinds).not.toContain("redemption_filled");
    expect(kinds).toContain("redemption_partially_filled");
  });

  it("detects a reorg of the cursor block itself when no new block is confirmed", async () => {
    chain.mine([indexCreated()]); // 1
    chain.mine([deposited(ALICE, 5n, 5n)]); // 2
    const indexer = makeIndexer(db, chain);
    await indexer.catchUp();
    chain.reorgFrom(2);
    chain.mine([deposited(BOB, 7n, 7n)]); // same height, different hash

    expect(await indexer.tick()).toEqual({ status: "reorg", rewoundTo: 1 });
    await indexer.catchUp();
    const wallets = listActivity(db, CHAIN_ID, { index: VAULT }, { limit: 50, offset: 0 }).map((a) => a.wallet);
    expect(wallets).toEqual([BOB]);
  });

  it("refuses to guess when the reorg is deeper than the stored window", async () => {
    chain.mine([indexCreated()]);
    const indexer = makeIndexer(db, chain);
    await indexer.catchUp();
    chain.reorgFrom(0);
    chain.mineEmpty(3);
    await expect(indexer.tick()).rejects.toBeInstanceOf(DeepReorgError);
  });

  it("rebuild from events reproduces incrementally derived state exactly", async () => {
    chain.mine([indexCreated(), deposited(ALICE, 1_000n, 1_000n), deposited(BOB, 500n, 500n)]);
    chain.mine([transfer(ALICE, BOB, 10n), requested(0n, ALICE, 400n), requested(1n, BOB, 100n)]);
    chain.mine([partiallyFilled(0n, ALICE, 150n, 150n)]);
    chain.mine([filled(0n, ALICE, 250n, 250n), filled(1n, BOB, 100n, 100n)]);
    await makeIndexer(db, chain, { batchBlocks: 1 }).catchUp();
    const incremental = snapshotDerived(db, CHAIN_ID);

    rebuildDerived(db, CHAIN_ID);
    expect(snapshotDerived(db, CHAIN_ID)).toEqual(incremental);
    expect(getRequest(db, CHAIN_ID, VAULT, 0)).toMatchObject({ status: RequestStatus.Fulfilled, remainingShares: "0", assetsPaid: "400" });
  });
});
