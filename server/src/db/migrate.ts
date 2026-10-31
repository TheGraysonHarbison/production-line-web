import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { withTransaction } from "./connection.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export interface MigrateResult {
  applied: number[];
  current: number;
}

/** `server/migrations/`, resolved identically from `src/db/` and `dist/db/`. */
export const DEFAULT_MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations",
);

const FILE_PATTERN = /^(\d{4})_([A-Za-z0-9_-]+)\.sql$/;

/** Loads numbered `.sql` files, sorted by version. Duplicate versions are an error. */
export function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Migration[] {
  const migrations: Migration[] = [];
  for (const file of readdirSync(dir)) {
    const match = FILE_PATTERN.exec(file);
    if (!match) continue;
    migrations.push({
      version: Number(match[1]),
      name: match[2] as string,
      sql: readFileSync(join(dir, file), "utf8"),
    });
  }
  migrations.sort((a, b) => a.version - b.version);
  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i]?.version === migrations[i - 1]?.version) {
      throw new Error(`duplicate migration version ${migrations[i]?.version} in ${dir}`);
    }
  }
  return migrations;
}

/**
 * Applies pending migrations in order, each inside its own transaction, and records them in
 * `schema_migrations` (dev doc §4). Forward-only: a database that has versions this build
 * doesn't know about is refused rather than silently used.
 */
export function migrate(
  db: DatabaseSync,
  migrations: Migration[] = loadMigrations(),
): MigrateResult {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
  );

  const appliedRows = db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as {
    version: number;
  }[];
  const applied = new Set(appliedRows.map((r) => r.version));
  const known = new Set(migrations.map((m) => m.version));

  for (const v of applied) {
    if (!known.has(v)) {
      throw new Error(
        `database has migration version ${v} which this build does not know about; refusing to start with a newer schema`,
      );
    }
  }

  const insert = db.prepare(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (:version, :applied_at)",
  );
  const newlyApplied: number[] = [];

  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    withTransaction(db, () => {
      db.exec(m.sql);
      insert.run({ version: m.version, applied_at: new Date().toISOString() });
    });
    newlyApplied.push(m.version);
  }

  const current = Math.max(0, ...migrations.map((m) => m.version));
  return { applied: newlyApplied, current };
}
