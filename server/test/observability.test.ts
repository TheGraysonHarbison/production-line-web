import { rmSync } from "node:fs";
import { Writable } from "node:stream";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { type Config, loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { ORIGIN, request, setupOwner } from "./auth-helpers.js";
import { createTestApp, type TestApp, tempDir } from "./helpers.js";

interface Line {
  level: number;
  msg: string;
  reqId?: string;
  [k: string]: unknown;
}

/** An app whose pino output is captured line by line, at the given level. */
async function capturedApp(level: string, overrides: Partial<Config> = {}) {
  const root = tempDir();
  const lines: Line[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      for (const raw of String(chunk).split("\n"))
        if (raw.trim()) lines.push(JSON.parse(raw) as Line);
      cb();
    },
  });
  const config: Config = { ...loadConfig({ LOG_LEVEL: level, DATA_DIR: root }), ...overrides };
  const log = pino({ level }, sink);
  const ctx = createContext(config, log);
  const app = await buildApp({ ctx, publicDir: "/nonexistent" });
  await app.ready();
  const t = {
    app,
    ctx,
    root,
    cleanup: async () => {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    },
  } as unknown as TestApp;
  return { t, lines };
}

describe("observability (dev doc §17)", () => {
  let t: TestApp;
  let lines: Line[];
  beforeEach(async () => {
    ({ t, lines } = await capturedApp("info"));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("logs every request at info with a request id, and the response with its status", async () => {
    await request(t, "GET", "/api/meta");
    const incoming = lines.find((l) => l.msg === "incoming request");
    const completed = lines.find((l) => l.msg === "request completed");
    expect(incoming?.level).toBe(30);
    expect(incoming?.reqId).toBeTruthy();
    expect(completed?.reqId).toBe(incoming?.reqId);
    expect((completed?.res as { statusCode: number }).statusCode).toBe(200);
  });

  it("auth.login_failed carries the username and IP", async () => {
    await setupOwner(t);
    const res = await request(t, "POST", "/api/auth/login", {
      body: { username: "owner", password: "wrong-one" },
    });
    expect(res.statusCode).toBe(401);
    const hit = lines.find((l) => l.msg === "auth.login_failed");
    expect(hit).toMatchObject({ level: 40, username: "owner", ip: expect.any(String) });
  });

  it("user.deleted carries who deleted whom and the cascaded counts", async () => {
    const owner = await setupOwner(t);
    const reg = await request(t, "POST", "/api/auth/register", {
      body: { username: "kim", password: "userpass1", favorite_color: "#123456" },
    });
    const kim = reg.json() as { id: number };
    const res = await request(t, "DELETE", `/api/users/${kim.id}`, { cookie: owner.cookie });
    expect(res.statusCode).toBe(204);
    expect(lines.find((l) => l.msg === "user.deleted")).toMatchObject({
      level: 30,
      by: owner.me.id,
      target: kim.id,
      sessions: 1,
      slots: 0,
      images: 0,
    });
  });
});

describe("rate limiting log and LOG_LEVEL", () => {
  it("auth.rate_limited is logged at warn when the login limit trips", async () => {
    const { t, lines } = await capturedApp("warn", { rateLimitAuthMax: 2 });
    try {
      await setupOwner(t);
      for (let i = 0; i < 3; i++) {
        await request(t, "POST", "/api/auth/login", {
          body: { username: "owner", password: "nope-nope" },
        });
      }
      const last = await request(t, "POST", "/api/auth/login", {
        body: { username: "owner", password: "ownerpass1" },
      });
      expect(last.statusCode).toBe(429);
      expect(last.json().error).toBe("rate_limited");
      expect(lines.find((l) => l.msg === "auth.rate_limited")).toMatchObject({
        level: 40,
        ip: expect.any(String),
        url: "/api/auth/login",
      });
      // At warn, the per-request info lines are gone.
      expect(lines.some((l) => l.msg === "incoming request")).toBe(false);
    } finally {
      await t.cleanup();
    }
  });

  it("LOG_LEVEL=silent produces nothing", async () => {
    const { t, lines } = await capturedApp("silent");
    try {
      await request(t, "GET", "/api/meta");
      await request(t, "POST", "/api/auth/login", {
        body: { username: "x", password: "yyyyyyyy" },
      });
      expect(lines).toEqual([]);
    } finally {
      await t.cleanup();
    }
  });
});

// Keep the shared helper import used so the file reads as one suite with the others.
void createTestApp;
void ORIGIN;
