import type { Db } from "./database.js";

/** Derived tables are a deterministic projection of `events`; see indexer/derive.ts. */
export const DERIVED_TABLES = ["indexes", "redemption_requests", "user_activity"] as const;

export interface IndexRow {
  address: string;
  curator: string;
  baseAsset: string;
  name: string;
  symbol: string;
  complianceModule: string;
  createdBlock: number;
  createdTx: string;
}

export interface RequestRow {
  indexAddress: string;
  requestId: number;
  owner: string;
  receiver: string;
  initialShares: string;
  remainingShares: string;
  minAssetsOut: string;
  assetsPaid: string;
  status: number;
  expiresAt: number;
  requestedAt: number;
  requestedBlock: number;
  updatedBlock: number;
  txHash: string;
}

export interface ActivityRow {
  eventId: number;
  wallet: string;
  indexAddress: string;
  kind: string;
  shares: string | null;
  assets: string | null;
  requestId: number | null;
  blockNumber: number;
  timestamp: number;
  txHash: string;
  logIndex: number;
}

export function clearDerived(db: Db, chainId: number): void {
  for (const table of DERIVED_TABLES) db.prepare(`DELETE FROM ${table} WHERE chain_id = ?`).run(chainId);
}

export function upsertIndex(db: Db, chainId: number, r: IndexRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO indexes (chain_id, address, curator, base_asset, name, symbol, compliance_module,
       created_block, created_tx) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(chainId, r.address, r.curator, r.baseAsset, r.name, r.symbol, r.complianceModule, r.createdBlock, r.createdTx);
}

const INDEX_COLUMNS = `address, curator, base_asset AS baseAsset, name, symbol, compliance_module AS complianceModule,
  created_block AS createdBlock, created_tx AS createdTx`;

export function listIndexRows(db: Db, chainId: number): IndexRow[] {
  return db
    .prepare(`SELECT ${INDEX_COLUMNS} FROM indexes WHERE chain_id = ? ORDER BY created_block, address`)
    .all(chainId) as unknown as IndexRow[];
}

export function getIndexRow(db: Db, chainId: number, address: string): IndexRow | undefined {
  return db.prepare(`SELECT ${INDEX_COLUMNS} FROM indexes WHERE chain_id = ? AND address = ?`).get(chainId, address) as
    | IndexRow
    | undefined;
}

export function upsertRequest(db: Db, chainId: number, r: RequestRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO redemption_requests (chain_id, index_address, request_id, owner, receiver, initial_shares,
       remaining_shares, min_assets_out, assets_paid, status, expires_at, requested_at, requested_block, updated_block,
       tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    chainId,
    r.indexAddress,
    r.requestId,
    r.owner,
    r.receiver,
    r.initialShares,
    r.remainingShares,
    r.minAssetsOut,
    r.assetsPaid,
    r.status,
    r.expiresAt,
    r.requestedAt,
    r.requestedBlock,
    r.updatedBlock,
    r.txHash,
  );
}

const REQUEST_COLUMNS = `index_address AS indexAddress, request_id AS requestId, owner, receiver,
  initial_shares AS initialShares, remaining_shares AS remainingShares, min_assets_out AS minAssetsOut,
  assets_paid AS assetsPaid, status, expires_at AS expiresAt, requested_at AS requestedAt,
  requested_block AS requestedBlock, updated_block AS updatedBlock, tx_hash AS txHash`;

export function getRequest(db: Db, chainId: number, index: string, requestId: number): RequestRow | undefined {
  return db
    .prepare(`SELECT ${REQUEST_COLUMNS} FROM redemption_requests WHERE chain_id = ? AND index_address = ? AND request_id = ?`)
    .get(chainId, index, requestId) as RequestRow | undefined;
}

export function listRequests(db: Db, chainId: number, index: string, statuses: readonly number[] | undefined): RequestRow[] {
  const all = db
    .prepare(`SELECT ${REQUEST_COLUMNS} FROM redemption_requests WHERE chain_id = ? AND index_address = ? ORDER BY request_id`)
    .all(chainId, index) as unknown as RequestRow[];
  return statuses ? all.filter((r) => statuses.includes(r.status)) : all;
}

export function listRequestsByOwner(db: Db, chainId: number, owner: string, statuses: readonly number[]): RequestRow[] {
  const all = db
    .prepare(`SELECT ${REQUEST_COLUMNS} FROM redemption_requests WHERE chain_id = ? AND owner = ? ORDER BY requested_block`)
    .all(chainId, owner) as unknown as RequestRow[];
  return all.filter((r) => statuses.includes(r.status));
}

export function insertActivity(db: Db, chainId: number, a: ActivityRow): void {
  db.prepare(
    `INSERT OR IGNORE INTO user_activity (chain_id, event_id, wallet, index_address, kind, shares, assets, request_id,
       block_number, timestamp, tx_hash, log_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    chainId,
    a.eventId,
    a.wallet,
    a.indexAddress,
    a.kind,
    a.shares,
    a.assets,
    a.requestId,
    a.blockNumber,
    a.timestamp,
    a.txHash,
    a.logIndex,
  );
}

const ACTIVITY_COLUMNS = `event_id AS eventId, wallet, index_address AS indexAddress, kind, shares, assets,
  request_id AS requestId, block_number AS blockNumber, timestamp, tx_hash AS txHash, log_index AS logIndex`;

export interface Page {
  limit: number;
  offset: number;
}

export function listActivity(
  db: Db,
  chainId: number,
  filter: { wallet?: string; index?: string },
  page: Page,
): ActivityRow[] {
  const column = filter.wallet !== undefined ? "wallet" : "index_address";
  const value = filter.wallet ?? filter.index ?? "";
  return db
    .prepare(
      `SELECT ${ACTIVITY_COLUMNS} FROM user_activity WHERE chain_id = ? AND ${column} = ?
       ORDER BY block_number DESC, log_index DESC, wallet LIMIT ? OFFSET ?`,
    )
    .all(chainId, value, page.limit, page.offset) as unknown as ActivityRow[];
}

/** Full dump in a stable order; used to verify rebuild equivalence. */
export function snapshotDerived(db: Db, chainId: number): Record<string, unknown[]> {
  return {
    indexes: db.prepare(`SELECT * FROM indexes WHERE chain_id = ? ORDER BY address`).all(chainId),
    requests: db
      .prepare(`SELECT * FROM redemption_requests WHERE chain_id = ? ORDER BY index_address, request_id`)
      .all(chainId),
    activity: db
      .prepare(
        `SELECT chain_id, event_id, wallet, index_address, kind, shares, assets, request_id, block_number, timestamp,
           tx_hash, log_index FROM user_activity WHERE chain_id = ? ORDER BY event_id, wallet`,
      )
      .all(chainId),
  };
}
