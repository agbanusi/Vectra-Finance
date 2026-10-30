import type { Db } from "./database.js";

export interface Cursor {
  blockNumber: number;
  blockHash: string;
}

export interface StoredBlock {
  blockNumber: number;
  blockHash: string;
  parentHash: string;
  timestamp: number;
}

export function getCursor(db: Db, chainId: number): Cursor | undefined {
  const row = db
    .prepare("SELECT block_number, block_hash FROM chain_cursor WHERE chain_id = ?")
    .get(chainId) as { block_number: number; block_hash: string } | undefined;
  return row ? { blockNumber: row.block_number, blockHash: row.block_hash } : undefined;
}

export function setCursor(db: Db, chainId: number, cursor: Cursor): void {
  db.prepare(
    `INSERT INTO chain_cursor (chain_id, block_number, block_hash, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (chain_id) DO UPDATE SET block_number = excluded.block_number,
       block_hash = excluded.block_hash, updated_at = excluded.updated_at`,
  ).run(chainId, cursor.blockNumber, cursor.blockHash, Date.now());
}

export function clearCursor(db: Db, chainId: number): void {
  db.prepare("DELETE FROM chain_cursor WHERE chain_id = ?").run(chainId);
}

export function putBlock(db: Db, chainId: number, block: StoredBlock): void {
  db.prepare(
    `INSERT INTO block_hashes (chain_id, block_number, block_hash, parent_hash, timestamp) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (chain_id, block_number) DO UPDATE SET block_hash = excluded.block_hash,
       parent_hash = excluded.parent_hash, timestamp = excluded.timestamp`,
  ).run(chainId, block.blockNumber, block.blockHash, block.parentHash, block.timestamp);
}

/** Stored blocks at or below `fromBlock`, newest first. Used to walk back to a common ancestor. */
export function blocksDescending(db: Db, chainId: number, fromBlock: number): StoredBlock[] {
  const rows = db
    .prepare(
      `SELECT block_number, block_hash, parent_hash, timestamp FROM block_hashes
       WHERE chain_id = ? AND block_number <= ? ORDER BY block_number DESC`,
    )
    .all(chainId, fromBlock) as { block_number: number; block_hash: string; parent_hash: string; timestamp: number }[];
  return rows.map((r) => ({
    blockNumber: r.block_number,
    blockHash: r.block_hash,
    parentHash: r.parent_hash,
    timestamp: r.timestamp,
  }));
}

export function pruneBlocks(db: Db, chainId: number, belowBlock: number): void {
  db.prepare("DELETE FROM block_hashes WHERE chain_id = ? AND block_number < ?").run(chainId, belowBlock);
}

/** Removes all chain-derived raw data strictly above `blockNumber` (events, hashes, snapshots). */
export function deleteAbove(db: Db, chainId: number, blockNumber: number): void {
  db.prepare("DELETE FROM events WHERE chain_id = ? AND block_number > ?").run(chainId, blockNumber);
  db.prepare("DELETE FROM block_hashes WHERE chain_id = ? AND block_number > ?").run(chainId, blockNumber);
  db.prepare("DELETE FROM nav_snapshots WHERE chain_id = ? AND block_number > ?").run(chainId, blockNumber);
}
