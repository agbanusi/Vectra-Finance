import type { Db } from "./database.js";

export type EventArgs = Record<string, string | number | boolean>;

export interface NewEvent {
  chainId: number;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  txHash: string;
  logIndex: number;
  address: string;
  eventName: string;
  args: EventArgs;
  topics: string[];
  data: string;
}

export interface StoredEvent extends NewEvent {
  id: number;
}

interface EventRow {
  id: number;
  chain_id: number;
  block_number: number;
  block_hash: string;
  block_timestamp: number;
  tx_hash: string;
  log_index: number;
  address: string;
  event_name: string;
  args_json: string;
  topics_json: string;
  data: string;
}

/** Inserts an event; returns its id, or undefined if this exact log was already stored. */
export function insertEvent(db: Db, e: NewEvent): StoredEvent | undefined {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO events (chain_id, block_number, block_hash, block_timestamp, tx_hash, log_index,
         address, event_name, args_json, topics_json, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.chainId,
      e.blockNumber,
      e.blockHash,
      e.blockTimestamp,
      e.txHash,
      e.logIndex,
      e.address,
      e.eventName,
      JSON.stringify(e.args),
      JSON.stringify(e.topics),
      e.data,
    );
  if (result.changes === 0) return undefined;
  return { ...e, id: Number(result.lastInsertRowid) };
}

function fromRow(r: EventRow): StoredEvent {
  return {
    id: r.id,
    chainId: r.chain_id,
    blockNumber: r.block_number,
    blockHash: r.block_hash,
    blockTimestamp: r.block_timestamp,
    txHash: r.tx_hash,
    logIndex: r.log_index,
    address: r.address,
    eventName: r.event_name,
    args: JSON.parse(r.args_json) as EventArgs,
    topics: JSON.parse(r.topics_json) as string[],
    data: r.data,
  };
}

/** All events in canonical chain order. */
export function eventsInOrder(db: Db, chainId: number): StoredEvent[] {
  const rows = db
    .prepare("SELECT * FROM events WHERE chain_id = ? ORDER BY block_number, log_index")
    .all(chainId) as unknown as EventRow[];
  return rows.map(fromRow);
}

export function countEvents(db: Db, chainId: number): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM events WHERE chain_id = ?").get(chainId) as { n: number };
  return row.n;
}
