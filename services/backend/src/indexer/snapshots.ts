import type { Address } from "viem";
import type { Db } from "../db/database.js";
import { blocksDescending, getCursor } from "../db/chain.js";
import { listIndexRows } from "../db/derived.js";
import { insertSnapshot } from "../db/snapshots.js";
import type { ProtocolReader } from "../chain/reader.js";

/**
 * Records one NAV snapshot per index at the indexer's confirmed cursor block, read through the lens
 * at that exact block. Snapshots are only ever real reads; nothing is interpolated.
 */
export async function takeSnapshots(db: Db, reader: ProtocolReader, chainId: number): Promise<number> {
  const cursor = getCursor(db, chainId);
  if (!cursor) return 0;
  const block = blocksDescending(db, chainId, cursor.blockNumber)[0];
  if (!block || block.blockNumber !== cursor.blockNumber) return 0;
  const addresses = listIndexRows(db, chainId).map((r) => r.address as Address);
  if (addresses.length === 0) return 0;

  const views = await reader.getIndexes(addresses, cursor.blockNumber);
  for (const v of views) {
    insertSnapshot(db, chainId, {
      indexAddress: v.vault,
      blockNumber: cursor.blockNumber,
      timestamp: block.timestamp,
      nav: v.nav.toString(),
      totalSupply: v.totalSupply.toString(),
      pricePerShare: v.pricePerShare.toString(),
      availableLiquidity: v.availableLiquidity.toString(),
      reservedAssets: v.reservedAssets.toString(),
      navHealthy: v.navHealthy,
    });
  }
  return views.length;
}
