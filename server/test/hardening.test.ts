import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp, type RegisteredRoute } from "../src/app.js";
import { closeDatabase, openDatabase } from "../src/db/connection.js";
import { ExpiryScheduler } from "../src/services/expiry.js";
import { HaClient } from "../src/services/ha.js";
import type { UserRow } from "../src/services/users.js";
import { ORIGIN, request, seedRoles } from "./auth-helpers.js";
import { createTestApp, createTestContext, type TestContext } from "./helpers.js";

/** Dev doc §7: the only routes that work without a session. */
const PUBLIC_ROUTES = new Set([
  "GET /api/meta",
  "POST /api/setup",
  "POST /api/auth/register",
  "POST /api/auth/login",
]);

/** Fills route params with values that pass Zod, so a 401 is about auth and nothing else. */
function concrete(url: string): string {
  return url
    .replace(":storedName", "00000000-0000-0000-0000-000000000000.png")
    .replace(/:[a-zA-Z]+/g, "1");
}

describe("route coverage (dev doc §9.1, §9.3)", () => {
  let tc: TestContext;
  let routes: RegisteredRoute[];
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    tc = createTestContext();
    routes = [];
    app = await buildApp({
      ctx: tc.ctx,
      publicDir: "/nonexistent",
      onRoute: (r) => {
        if (r.url.startsWith("/api")) routes.push(r);
      },
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    tc.cleanup();
  });

  it("registers every /api route behind requireAuth/requireRole/requireSlotAccess unless public", () => {
    expect(routes.length).toBeGreaterThan(20);
    const unguarded = routes
      .filter((r) => r.method !== "HEAD" && r.method !== "OPTIONS")
      .filter((r) => !PUBLIC_ROUTES.has(`${r.method} ${r.url}`))
      .filter(
        (r) =>
          !r.preHandler.some(
            (h) =>
              typeof h === "function" &&
              /^(requireAuth|requireRole|requireSlotAccess)/.test(h.name),
          ),
      )
      .map((r) => `${r.method} ${r.url}`);
    expect(unguarded).toEqual([]);
    // And the public list is exactly the documented four.
    const publicSeen = routes
      .filter((r) => PUBLIC_ROUTES.has(`${r.method} ${r.url}`))
      .map((r) => `${r.method} ${r.url}`);
    expect(new Set(publicSeen)).toEqual(PUBLIC_ROUTES);
  });

  it("answers 401 to every non-public /api route without a session", async () => {
    const seen: string[] = [];
    for (const r of routes) {
      if (r.method === "HEAD" || r.method === "OPTIONS") continue;
      const key = `${r.method} ${r.url}`;
      if (PUBLIC_ROUTES.has(key)) continue;
      const res = await app.inject({
        method: r.method as "GET",
        url: concrete(r.url),
        headers: { origin: ORIGIN },
      });
      seen.push(`${key} → ${res.statusCode}`);
      expect(res.statusCode, key).toBe(401);
      expect(res.json()).toEqual({ error: "unauthorized", message: "unauthorized" });
    }
    expect(seen.length).toBeGreaterThan(18);
  });
});

describe("CSRF origin check behind a reverse proxy (dev doc §9.6)", () => {
  it("honours X-Forwarded-Proto/Host only with TRUST_PROXY=1", async () => {
    for (const trustProxy of [false, true]) {
      const tc = createTestContext({ trustProxy });
      const app = await buildApp({ ctx: tc.ctx, publicDir: "/nonexistent" });
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/api/setup",
        headers: {
          origin: "https://printers.example.com",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "printers.example.com",
          host: "10.0.0.5:8080",
        },
        payload: { username: "owner", password: "ownerpass1", favorite_color: "#112233" },
      });
      if (trustProxy) expect(res.statusCode, "trusted proxy").toBe(201);
      else {
        expect(res.statusCode, "untrusted").toBe(403);
        expect(res.json().error).toBe("csrf_origin_mismatch");
      }
      await app.close();
      tc.cleanup();
    }
  });
});

describe("error handling (dev doc §7)", () => {
  it("maps an unexpected throw to 500 { error: 'internal' } with no message or stack", async () => {
    const tc = createTestContext();
    const app = await buildApp({ ctx: tc.ctx, publicDir: "/nonexistent" });
    app.get("/api/boom", async () => {
      throw new Error("secret internals: /etc/passwd");
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal" });
    expect(res.body).not.toContain("secret internals");
    await app.close();
    tc.cleanup();
  });

  it("returns JSON 404 for unknown /api paths on every method", async () => {
    const t = await createTestApp();
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
      const res = await t.app.inject({
        method,
        url: "/api/does-not-exist",
        headers: { origin: ORIGIN },
      });
      expect(res.statusCode, method).toBe(404);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.json()).toEqual({ error: "not_found" });
    }
    await t.cleanup();
  });
});

describe("database robustness (dev doc §6, §16)", () => {
  it("checkpoints the WAL on close so app.db alone is a complete copy", async () => {
    const t = await createTestApp();
    await seedRoles(t);
    const wal = join(t.root, "app.db-wal");
    expect(existsSync(wal) && statSync(wal).size > 0).toBe(true);
    await t.app.close();
    expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
    // The main file on its own has everything.
    const db = openDatabase(join(t.root, "app.db"));
    expect((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(3);
    closeDatabase(db);
    t.cleanup();
  });

  it("waits out a concurrent writer thanks to busy_timeout instead of failing", async () => {
    const tc = createTestContext();
    const path = tc.ctx.dataDir.dbPath;
    tc.ctx.db.exec("CREATE TABLE IF NOT EXISTS t (v TEXT)");
    // A worker takes the write lock for 400 ms; node:sqlite is synchronous, so this thread
    // would block forever on its own.
    const worker = new Worker(
      `
      const { DatabaseSync } = require("node:sqlite");
      const { workerData, parentPort } = require("node:worker_threads");
      const db = new DatabaseSync(workerData.path);
      db.exec("PRAGMA busy_timeout = 5000;");
      db.exec("BEGIN IMMEDIATE;");
      db.exec("INSERT INTO t VALUES ('worker')");
      parentPort.postMessage("locked");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
      db.exec("COMMIT;");
      db.close();
      `,
      { eval: true, workerData: { path } },
    );
    await new Promise<void>((resolve) => worker.once("message", () => resolve()));
    const started = Date.now();
    tc.ctx.db.exec("INSERT INTO t VALUES ('main')");
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(250);
    expect(waited).toBeLessThan(5000);
    await new Promise<void>((resolve) => worker.once("exit", () => resolve()));
    const rows = tc.ctx.db.prepare("SELECT v FROM t ORDER BY v").all();
    expect(rows).toEqual([{ v: "main" }, { v: "worker" }]);
    tc.cleanup();
  });
});

describe("scheduler robustness (dev doc §3.4)", () => {
  it("logs a slot that throws and continues with the next", async () => {
    const t = await createTestApp();
    const roles = await seedRoles(t);
    const user = t.ctx.users.findById(roles.user.me.id) as UserRow;
    const printers: number[] = [];
    for (const name of ["A", "B"]) {
      const res = await request(t, "POST", "/api/printers", {
        cookie: roles.admin.cookie,
        body: { name },
      });
      printers.push(res.json().id);
    }
    const T0 = Date.now();
    const mk = (name: string, printer: number) =>
      t.ctx.slots.create(
        user,
        {
          name,
          description: null,
          start_at: new Date(T0 - 60 * 60_000).toISOString(),
          end_at: new Date(T0 - 30 * 60_000).toISOString(),
          printer_ids: [printer],
        },
        new Date(T0 - 90 * 60_000),
      );
    const bad = mk("bad", printers[0] as number);
    const good = mk("good", printers[1] as number);
    const original = t.ctx.slots.delete.bind(t.ctx.slots);
    const spy = vi.spyOn(t.ctx.slots, "delete").mockImplementation((id, reason) => {
      if (id === bad.id) throw new Error("disk on fire");
      return original(id, reason);
    });
    const errors: unknown[] = [];
    (t.ctx.log as unknown as { error: unknown }).error = (obj: unknown) => errors.push(obj);
    const s = new ExpiryScheduler({
      slots: t.ctx.slots,
      settings: t.ctx.settings,
      ha: new HaClient(t.ctx.settings, t.ctx.log),
      log: t.ctx.log,
    });
    const processed = await s.run(true);
    expect(processed).toBe(1);
    expect(() => t.ctx.slots.get(good.id)).toThrow();
    expect(t.ctx.slots.get(bad.id).name).toBe("bad");
    expect(errors).toEqual([expect.objectContaining({ slotId: bad.id })]);
    spy.mockRestore();
    await s.stop();
    await t.cleanup();
  });
});
