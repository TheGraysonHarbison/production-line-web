import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

describe("static client + SPA fallback", () => {
  let app: FastifyInstance;
  let publicDir: string;

  beforeAll(async () => {
    publicDir = mkdtempSync(join(tmpdir(), "plw-public-"));
    writeFileSync(join(publicDir, "index.html"), "<!doctype html><title>plw-test</title>");
    writeFileSync(join(publicDir, "asset.txt"), "hello");
    app = await buildApp({ config: loadConfig({ LOG_LEVEL: "silent" }), publicDir });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(publicDir, { recursive: true, force: true });
  });

  it("serves index.html at /", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("plw-test");
  });

  it("serves real static files", async () => {
    const res = await app.inject({ method: "GET", url: "/asset.txt" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("hello");
  });

  it("falls back to index.html for unknown client routes", async () => {
    const res = await app.inject({ method: "GET", url: "/some/deep/link" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("plw-test");
  });

  it("still returns JSON 404 for unknown API paths", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });

  it("does not fall back for non-GET requests", async () => {
    const res = await app.inject({ method: "POST", url: "/some/deep/link" });
    expect(res.statusCode).toBe(404);
  });
});
