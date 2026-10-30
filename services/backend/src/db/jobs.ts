import type { Db } from "./database.js";

/**
 * Acquires (or renews) a lease on `jobKey`. Succeeds only if no lease exists, the existing lease has
 * expired, or it is already held by `owner`. Atomic thanks to SQLite's single-writer upsert.
 */
export function acquireLease(db: Db, jobKey: string, owner: string, ttlMs: number, now: number): boolean {
  db.prepare(
    `INSERT INTO job_leases (job_key, owner, expires_at) VALUES (?, ?, ?)
     ON CONFLICT (job_key) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
     WHERE job_leases.expires_at <= ? OR job_leases.owner = excluded.owner`,
  ).run(jobKey, owner, now + ttlMs, now);
  const row = db.prepare("SELECT owner FROM job_leases WHERE job_key = ?").get(jobKey) as { owner: string } | undefined;
  return row?.owner === owner;
}

export function releaseLease(db: Db, jobKey: string, owner: string): void {
  db.prepare("DELETE FROM job_leases WHERE job_key = ? AND owner = ?").run(jobKey, owner);
}

export type JobStatus =
  | "success"
  | "noop"
  | "dry_run"
  | "simulation_reverted"
  | "deferred_gas"
  | "lease_busy"
  | "reverted"
  | "failed";

export interface JobRun {
  jobKey: string;
  action: string;
  status: JobStatus;
  attempts: number;
  txHash: string | null;
  detail: string | null;
  startedAt: number;
  finishedAt: number;
}

export function recordRun(db: Db, run: JobRun): void {
  db.prepare(
    `INSERT INTO job_runs (job_key, action, status, attempts, tx_hash, detail, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(run.jobKey, run.action, run.status, run.attempts, run.txHash, run.detail, run.startedAt, run.finishedAt);
}

export function recentRuns(db: Db, limit: number): JobRun[] {
  return db
    .prepare(
      `SELECT job_key AS jobKey, action, status, attempts, tx_hash AS txHash, detail, started_at AS startedAt,
         finished_at AS finishedAt FROM job_runs ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as unknown as JobRun[];
}

export interface DeadLetter {
  id: number;
  jobKey: string;
  actionJson: string;
  error: string;
  attempts: number;
  createdAt: number;
  resolvedAt: number | null;
}

export function addDeadLetter(db: Db, d: Omit<DeadLetter, "id" | "resolvedAt">): void {
  db.prepare(
    "INSERT INTO dead_letters (job_key, action_json, error, attempts, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(d.jobKey, d.actionJson, d.error, d.attempts, d.createdAt);
}

export function openDeadLetters(db: Db, limit: number): DeadLetter[] {
  return db
    .prepare(
      `SELECT id, job_key AS jobKey, action_json AS actionJson, error, attempts, created_at AS createdAt,
         resolved_at AS resolvedAt FROM dead_letters WHERE resolved_at IS NULL ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as unknown as DeadLetter[];
}

export function countOpenDeadLetters(db: Db): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM dead_letters WHERE resolved_at IS NULL").get() as { n: number };
  return row.n;
}

export function countRunsByStatus(db: Db): { status: string; n: number }[] {
  return db.prepare("SELECT status, COUNT(*) AS n FROM job_runs GROUP BY status").all() as unknown as {
    status: string;
    n: number;
  }[];
}
