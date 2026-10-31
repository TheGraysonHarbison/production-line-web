import { DatabaseSync } from "node:sqlite";

/**
 * Opens the SQLite database with the pragmas required on every connection (dev doc §6):
 * WAL journaling, enforced foreign keys, and a 5 s busy timeout.
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

/**
 * Runs `fn` inside an IMMEDIATE transaction (takes the write lock up front so concurrent
 * writers serialise instead of failing mid-transaction). Rolls back on any throw.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = fn();
    db.exec("COMMIT;");
    return result;
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

export function pragma<T = Record<string, unknown>>(db: DatabaseSync, name: string): T {
  return db.prepare(`PRAGMA ${name};`).get() as T;
}
