import { MetaSchema } from "@production-line/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

describe("GET /api/meta", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      config: loadConfig({ LOG_LEVEL: "silent" }),
      publicDir: "/nonexistent",
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns a valid meta object", async () => {
    const res = await app.inject({ method: "GET", url: "/api/meta" });
    expect(res.statusCode).toBe(200);
    expect(() => MetaSchema.parse(res.json())).not.toThrow();
  });

  it("returns JSON 404 for unknown API paths", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });
});

describe("loadConfig", () => {
  it("applies defaults", () => {
    const cfg = loadConfig({});
    expect(cfg).toEqual({ port: 8080, host: "0.0.0.0", logLevel: "info" });
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
  });

  it("rejects an invalid log level", () => {
    expect(() => loadConfig({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });
});
