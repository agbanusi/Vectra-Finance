import type { Db } from "./database.js";

export interface NavSnapshot {
  indexAddress: string;
  blockNumber: number;
  timestamp: number;
  nav: string;
  totalSupply: string;
  pricePerShare: string;
  availableLiquidity: string;
  reservedAssets: string;
  navHealthy: boolean;
}

export function insertSnapshot(db: Db, chainId: number, s: NavSnapshot): void {
  db.prepare(
    `INSERT OR IGNORE INTO nav_snapshots (chain_id, index_address, block_number, timestamp, nav, total_supply,
       price_per_share, available_liquidity, reserved_assets, nav_healthy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    chainId,
    s.indexAddress,
    s.blockNumber,
    s.timestamp,
    s.nav,
    s.totalSupply,
    s.pricePerShare,
    s.availableLiquidity,
    s.reservedAssets,
    s.navHealthy ? 1 : 0,
  );
}

interface SnapshotRow extends Omit<NavSnapshot, "navHealthy"> {
  navHealthy: number;
}

export function listSnapshots(
  db: Db,
  chainId: number,
  index: string,
  range: { from: number; to: number; limit: number },
): NavSnapshot[] {
  const rows = db
    .prepare(
      `SELECT index_address AS indexAddress, block_number AS blockNumber, timestamp, nav, total_supply AS totalSupply,
         price_per_share AS pricePerShare, available_liquidity AS availableLiquidity, reserved_assets AS reservedAssets,
         nav_healthy AS navHealthy
       FROM nav_snapshots WHERE chain_id = ? AND index_address = ? AND timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp, block_number LIMIT ?`,
    )
    .all(chainId, index, range.from, range.to, range.limit) as unknown as SnapshotRow[];
  return rows.map((r) => ({ ...r, navHealthy: r.navHealthy === 1 }));
}
