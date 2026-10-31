import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, pragma, withTransaction } from "../src/db/connection.js";
import { DEFAULT_MIGRATIONS_DIR, loadMigrations, migrate } from "../src/db/migrate.js";
import { tempDir } from "./helpers.js";

describe("openDatabase", () => {
  let root: string;
  beforeEach(() => {
    root = tempDir();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("applies the required pragmas", () => {
    const db = openDatabase(join(root, "app.db"));
    expect(pragma(db, "journal_mode")).toMatchObject({ journal_mode: "wal" });
    expect(pragma(db, "foreign_keys")).toMatchObject({ foreign_keys: 1 });
    expect(pragma(db, "busy_timeout")).toMatchObject({ timeout: 5000 });
    db.close();
  });

  it("withTransaction commits on success and rolls back on throw", () => {
    const db = openDatabase(join(root, "app.db"));
    db.exec("CREATE TABLE t (v TEXT)");
    withTransaction(db, () => db.exec("INSERT INTO t VALUES ('a')"));
    expect(() =>
      withTransaction(db, () => {
        db.exec("INSERT INTO t VALUES ('b')");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    const rows = db.prepare("SELECT v FROM t").all();
    expect(rows).toEqual([{ v: "a" }]);
    db.close();
  });
});

describe("migrations", () => {
  let root: string;
  beforeEach(() => {
    root = tempDir();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("loads the shipped migrations in order", () => {
    const list = loadMigrations(DEFAULT_MIGRATIONS_DIR);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]).toMatchObject({ version: 1, name: "init" });
  });

  it("applies once and is a no-op on the second run", () => {
    const db = openDatabase(join(root, "app.db"));
    const first = migrate(db);
    expect(first.applied).toEqual([1]);
    expect(first.current).toBe(1);
    const second = migrate(db);
    expect(second.applied).toEqual([]);

    const rows = db.prepare("SELECT version, applied_at FROM schema_migrations").all() as {
      version: number;
      applied_at: string;
    }[];
    expect(rows.map((r) => r.version)).toEqual([1]);
    expect(rows[0]?.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(tables).toEqual([
      "images",
      "printers",
      "schema_migrations",
      "sessions",
      "settings",
      "slot_printers",
      "slots",
      "users",
    ]);
    db.close();
  });

  it("enforces the single-owner index and the slot time check", () => {
    const db = openDatabase(join(root, "app.db"));
    migrate(db);
    const ins = db.prepare(
      "INSERT INTO users (username, password_hash, color, role, created_at) VALUES (:u, 'x', '#000000', :role, '2026-01-01T00:00:00.000Z')",
    );
    ins.run({ u: "a", role: "owner" });
    expect(() => ins.run({ u: "b", role: "owner" })).toThrow(/UNIQUE/);
    ins.run({ u: "c", role: "admin" });
    expect(() => ins.run({ u: "A", role: "user" })).toThrow(/UNIQUE/); // case-insensitive username

    expect(() =>
      db
        .prepare(
          "INSERT INTO slots (user_id, name, start_at, end_at, created_at, updated_at) VALUES (1, 's', '2026-01-01T01:00:00.000Z', '2026-01-01T00:00:00.000Z', 'x', 'x')",
        )
        .run(),
    ).toThrow(/CHECK/);
    db.close();
  });

  it("rolls back a failing migration without recording it", () => {
    const dir = join(root, "migrations");
    mkdirSync(dir);
    writeFileSync(join(dir, "0001_ok.sql"), "CREATE TABLE a (id INTEGER);");
    writeFileSync(
      join(dir, "0002_bad.sql"),
      "CREATE TABLE b (id INTEGER); CREATE TABLE a (id INTEGER);",
    );
    const db = openDatabase(join(root, "app.db"));
    expect(() => migrate(db, loadMigrations(dir))).toThrow();
    const versions = (
      db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]
    ).map((r) => r.version);
    expect(versions).toEqual([1]);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).not.toContain("b");
    db.close();
  });

  it("refuses a database newer than the code", () => {
    const db = openDatabase(join(root, "app.db"));
    migrate(db);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (99, 'x')").run();
    expect(() => migrate(db)).toThrow(/version 99/);
    db.close();
  });

  it("rejects duplicate versions", () => {
    const dir = join(root, "migrations");
    mkdirSync(dir);
    writeFileSync(join(dir, "0001_a.sql"), "SELECT 1;");
    writeFileSync(join(dir, "0001_b.sql"), "SELECT 1;");
    expect(() => loadMigrations(dir)).toThrow(/duplicate/);
  });
});
