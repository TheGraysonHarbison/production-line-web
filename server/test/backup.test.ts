import { readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupFilename } from "../src/routes/backup.js";
import { request, seedRoles } from "./auth-helpers.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("GET /api/backup", () => {
  let t: TestApp;
  let roles: Awaited<ReturnType<typeof seedRoles>>;
  beforeEach(async () => {
    t = await createTestApp();
    roles = await seedRoles(t);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("names the file production-line-YYYYMMDD-HHMM.db in UTC", () => {
    expect(backupFilename(new Date("2026-11-02T21:30:14Z"))).toBe(
      "production-line-20261102-2130.db",
    );
  });

  it("is admin-only", async () => {
    expect((await request(t, "GET", "/api/backup")).statusCode).toBe(401);
    expect((await request(t, "GET", "/api/backup", { cookie: roles.user.cookie })).statusCode).toBe(
      403,
    );
  });

  it("streams a consistent SQLite copy and removes the temp file", async () => {
    const res = await request(t, "GET", "/api/backup", { cookie: roles.admin.cookie });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/vnd.sqlite3");
    expect(res.headers["content-disposition"]).toMatch(
      /^attachment; filename="production-line-\d{8}-\d{4}\.db"$/,
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(Number(res.headers["content-length"])).toBe(res.rawPayload.length);
    // It is a real database with our data in it.
    expect(res.rawPayload.subarray(0, 16).toString("latin1")).toBe("SQLite format 3\0");
    const path = `${t.root}/restored.db`;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, res.rawPayload);
    const db = new DatabaseSync(path, { readOnly: true });
    const users = db.prepare("SELECT username FROM users ORDER BY username").all() as {
      username: string;
    }[];
    expect(users.map((u) => u.username)).toEqual(["admin", "owner", "user"]);
    expect(db.prepare("SELECT version FROM schema_migrations").all()).toEqual([{ version: 1 }]);
    db.close();
    // The temp file under DATA_DIR is gone once the stream closed.
    await new Promise((r) => setTimeout(r, 50));
    expect(readdirSync(t.root).filter((f) => f.startsWith(".backup-"))).toEqual([]);
  });
});
