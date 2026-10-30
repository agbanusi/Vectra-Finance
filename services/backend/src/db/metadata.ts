import type { Db } from "./database.js";

export const RISK_TIERS = ["low", "medium", "high"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export interface IndexMetadata {
  description: string | null;
  category: string | null;
  riskTier: RiskTier | null;
  tags: string[];
  updatedAt: number;
}

export function getMetadata(db: Db, chainId: number, address: string): IndexMetadata | undefined {
  const row = db
    .prepare(
      `SELECT description, category, risk_tier, tags_json, updated_at FROM index_metadata WHERE chain_id = ? AND address = ?`,
    )
    .get(chainId, address) as
    | { description: string | null; category: string | null; risk_tier: RiskTier | null; tags_json: string; updated_at: number }
    | undefined;
  if (!row) return undefined;
  return {
    description: row.description,
    category: row.category,
    riskTier: row.risk_tier,
    tags: JSON.parse(row.tags_json) as string[],
    updatedAt: row.updated_at,
  };
}

export function putMetadata(db: Db, chainId: number, address: string, m: Omit<IndexMetadata, "updatedAt">): IndexMetadata {
  const updatedAt = Date.now();
  db.prepare(
    `INSERT INTO index_metadata (chain_id, address, description, category, risk_tier, tags_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (chain_id, address) DO UPDATE SET description = excluded.description, category = excluded.category,
       risk_tier = excluded.risk_tier, tags_json = excluded.tags_json, updated_at = excluded.updated_at`,
  ).run(chainId, address, m.description, m.category, m.riskTier, JSON.stringify(m.tags), updatedAt);
  return { ...m, updatedAt };
}
