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
  // sql: `name` is always a literal from our own code (journal_mode, foreign_keys, …).
  return db.prepare(`PRAGMA ${name};`).get() as T;
}

/**
 * Folds the WAL back into the main file and closes (dev doc §16: a stopped app leaves one clean
 * `app.db`, so a copy taken while stopped is complete). Safe to call on an already-closed handle.
 */
export function closeDatabase(db: DatabaseSync): void {
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    // Already closed or not in WAL mode: nothing to fold.
  }
  try {
    db.close();
  } catch {
    // Already closed.
  }
}
