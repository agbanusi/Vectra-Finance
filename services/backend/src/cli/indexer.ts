import { viemChainSource } from "../chain/source.js";
import { viemProtocolReader } from "../chain/reader.js";
import { Indexer } from "../indexer/indexer.js";
import { takeSnapshots } from "../indexer/snapshots.js";
import { bootstrap, fatal, runLoop } from "../runtime.js";

const rt = (() => {
  try {
    return bootstrap("indexer");
  } catch (err) {
    return fatal(undefined, err);
  }
})();

const { config, deployment, db, client, logger } = rt;
const indexer = new Indexer({
  db,
  source: viemChainSource(client),
  chainId: config.chainId,
  factory: deployment.factory,
  startBlock: deployment.startBlock,
  confirmations: config.indexer.confirmations,
  batchBlocks: config.indexer.batchBlocks,
  reorgWindowBlocks: config.indexer.reorgWindowBlocks,
  logger,
});
const reader = viemProtocolReader(client, deployment.lens);
let lastSnapshot = 0;

logger.info("indexer starting", { chainId: config.chainId, factory: deployment.factory, startBlock: deployment.startBlock });
await runLoop("indexer", config.indexer.pollMs, logger, async () => {
  const results = await indexer.catchUp();
  const ingested = results.filter((r) => r.status === "ingested").length;
  if (ingested > 0) logger.info("indexer progressed", { last: results.at(-1) });
  if (Date.now() - lastSnapshot >= config.indexer.snapshotIntervalMs) {
    const n = await takeSnapshots(db, reader, config.chainId);
    lastSnapshot = Date.now();
    logger.debug("nav snapshots", { count: n });
  }
});
db.close();
