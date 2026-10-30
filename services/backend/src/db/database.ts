import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

const BUSY_TIMEOUT_MS = 5_000;
export const IN_MEMORY = ":memory:";

/** Opens SQLite with WAL so the API, indexer and keeper processes can share one file. */
export function openDatabase(path: string): Db {
  if (path !== IN_MEMORY) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  if (path !== IN_MEMORY) db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

/** Runs `fn` inside an IMMEDIATE transaction; rolls back and rethrows on any error. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
