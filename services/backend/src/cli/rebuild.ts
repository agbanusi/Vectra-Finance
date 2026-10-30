import { transaction } from "../db/database.js";
import { clearCursor } from "../db/chain.js";
import { rebuildDerived } from "../indexer/derive.js";
import { bootstrap, fatal } from "../runtime.js";

/**
 * `rebuild`             — re-derive indexes/requests/activity from stored raw events (no RPC needed).
 * `rebuild --from-chain` — also drop raw events, hashes and snapshots, so the indexer re-ingests from
 *                          startBlock (use after a reorg deeper than REORG_WINDOW_BLOCKS).
 */
const rt = (() => {
  try {
    return bootstrap("rebuild");
  } catch (err) {
    return fatal(undefined, err);
  }
})();

const { db, config, logger } = rt;
if (process.argv.includes("--from-chain")) {
  transaction(db, () => {
    for (const table of ["events", "block_hashes", "nav_snapshots"]) db.prepare(`DELETE FROM ${table} WHERE chain_id = ?`).run(config.chainId);
    clearCursor(db, config.chainId);
  });
  logger.warn("raw chain data cleared; the indexer will re-ingest from startBlock");
}
const replayed = rebuildDerived(db, config.chainId);
logger.info("derived state rebuilt", { events: replayed });
db.close();
