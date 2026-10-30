import { loadConfig } from "../config.js";
import { openDatabase } from "../db/database.js";
import { currentVersion, migrate } from "../db/migrations.js";
import { createLogger } from "../util/log.js";
import { fatal } from "../runtime.js";

try {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, base: { service: "migrate" } });
  const db = openDatabase(config.databasePath);
  const applied = migrate(db);
  logger.info("migrations complete", { applied, version: currentVersion(db) });
  db.close();
} catch (err) {
  fatal(undefined, err);
}
