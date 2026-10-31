import { MetaSchema } from "@production-line/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("GET /api/meta", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("reports setup_required on an empty database with defaults", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/meta" });
    expect(res.statusCode).toBe(200);
    const meta = MetaSchema.parse(res.json());
    expect(meta).toEqual({
      setup_required: true,
      registration_enabled: true,
      images_enabled: false,
      timezone: "UTC",
    });
  });

  it("reflects users and settings from the database", async () => {
    t.ctx.db
      .prepare(
        `INSERT INTO users (username, password_hash, color, role, created_at)
         VALUES ('owner', 'x', '#123456', 'owner', '2026-01-01T00:00:00.000Z')`,
      )
      .run();
    t.ctx.settings.update({
      registration_enabled: false,
      images_enabled: true,
      timezone: "Europe/Oslo",
    });

    const res = await t.app.inject({ method: "GET", url: "/api/meta" });
    expect(res.json()).toEqual({
      setup_required: false,
      registration_enabled: false,
      images_enabled: true,
      timezone: "Europe/Oslo",
    });
  });

  it("returns JSON 404 for unknown API paths", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });
});

describe("loadConfig", () => {
  it("applies defaults", () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(8080);
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.logLevel).toBe("info");
    expect(cfg.trustProxy).toBe(false);
    expect(cfg.dataDir.endsWith("/data")).toBe(true);
    expect(cfg.dataDir.startsWith("/")).toBe(true);
  });

  it("parses TRUST_PROXY and DATA_DIR", () => {
    expect(loadConfig({ TRUST_PROXY: "1" }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: "0" }).trustProxy).toBe(false);
    expect(loadConfig({ DATA_DIR: "/var/lib/plw" }).dataDir).toBe("/var/lib/plw");
  });

  it("rejects invalid values", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
    expect(() => loadConfig({ TRUST_PROXY: "yes" })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ DATA_DIR: "  " })).toThrow(/DATA_DIR/);
  });
});
