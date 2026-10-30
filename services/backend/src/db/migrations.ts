import { transaction, type Db } from "./database.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Append-only. Never edit a released migration; add a new version instead. */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial",
    sql: `
      CREATE TABLE chain_cursor (
        chain_id INTEGER PRIMARY KEY,
        block_number INTEGER NOT NULL,
        block_hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE block_hashes (
        chain_id INTEGER NOT NULL,
        block_number INTEGER NOT NULL,
        block_hash TEXT NOT NULL,
        parent_hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (chain_id, block_number)
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chain_id INTEGER NOT NULL,
        block_number INTEGER NOT NULL,
        block_hash TEXT NOT NULL,
        block_timestamp INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        address TEXT NOT NULL,
        event_name TEXT NOT NULL,
        args_json TEXT NOT NULL,
        topics_json TEXT NOT NULL,
        data TEXT NOT NULL,
        UNIQUE (chain_id, block_hash, log_index)
      );
      CREATE INDEX events_order ON events (chain_id, block_number, log_index);
      CREATE INDEX events_address ON events (chain_id, address, block_number);

      CREATE TABLE indexes (
        chain_id INTEGER NOT NULL,
        address TEXT NOT NULL,
        curator TEXT NOT NULL,
        base_asset TEXT NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        compliance_module TEXT NOT NULL,
        created_block INTEGER NOT NULL,
        created_tx TEXT NOT NULL,
        PRIMARY KEY (chain_id, address)
      );
      CREATE TABLE index_metadata (
        chain_id INTEGER NOT NULL,
        address TEXT NOT NULL,
        description TEXT,
        category TEXT,
        risk_tier TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (chain_id, address)
      );
      CREATE TABLE redemption_requests (
        chain_id INTEGER NOT NULL,
        index_address TEXT NOT NULL,
        request_id INTEGER NOT NULL,
        owner TEXT NOT NULL,
        receiver TEXT NOT NULL,
        initial_shares TEXT NOT NULL,
        remaining_shares TEXT NOT NULL,
        min_assets_out TEXT NOT NULL,
        assets_paid TEXT NOT NULL,
        status INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        requested_at INTEGER NOT NULL,
        requested_block INTEGER NOT NULL,
        updated_block INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        PRIMARY KEY (chain_id, index_address, request_id)
      );
      CREATE INDEX redemption_requests_owner ON redemption_requests (chain_id, owner, status);
      CREATE TABLE user_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chain_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        wallet TEXT NOT NULL,
        index_address TEXT NOT NULL,
        kind TEXT NOT NULL,
        shares TEXT,
        assets TEXT,
        request_id INTEGER,
        block_number INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        UNIQUE (event_id, wallet)
      );
      CREATE INDEX user_activity_wallet ON user_activity (chain_id, wallet, block_number);
      CREATE INDEX user_activity_index ON user_activity (chain_id, index_address, block_number);
      CREATE TABLE nav_snapshots (
        chain_id INTEGER NOT NULL,
        index_address TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        nav TEXT NOT NULL,
        total_supply TEXT NOT NULL,
        price_per_share TEXT NOT NULL,
        available_liquidity TEXT NOT NULL,
        reserved_assets TEXT NOT NULL,
        nav_healthy INTEGER NOT NULL,
        PRIMARY KEY (chain_id, index_address, block_number)
      );
      CREATE INDEX nav_snapshots_time ON nav_snapshots (chain_id, index_address, timestamp);

      CREATE TABLE job_leases (
        job_key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE job_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_key TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        tx_hash TEXT,
        detail TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER NOT NULL
      );
      CREATE INDEX job_runs_recent ON job_runs (finished_at);
      CREATE TABLE dead_letters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_key TEXT NOT NULL,
        action_json TEXT NOT NULL,
        error TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
    `,
  },
];

export function currentVersion(db: Db): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  return row.v ?? 0;
}

/** Applies pending migrations in order, each atomically. Safe to run repeatedly. */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number[] {
  const applied: number[] = [];
  const from = currentVersion(db);
  for (const m of migrations) {
    if (m.version <= from) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        Date.now(),
      );
    });
    applied.push(m.version);
  }
  return applied;
}
