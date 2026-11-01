import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { HaTestResultSchema, PublicSettingsSchema } from "@production-line/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { request, seedRoles } from "./auth-helpers.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("/api/settings", () => {
  let t: TestApp;
  let roles: Awaited<ReturnType<typeof seedRoles>>;
  beforeEach(async () => {
    t = await createTestApp();
    roles = await seedRoles(t);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("is admin-only to read", async () => {
    expect((await request(t, "GET", "/api/settings")).statusCode).toBe(401);
    expect(
      (await request(t, "GET", "/api/settings", { cookie: roles.user.cookie })).statusCode,
    ).toBe(403);
    const res = await request(t, "GET", "/api/settings", { cookie: roles.admin.cookie });
    expect(res.statusCode).toBe(200);
    expect(PublicSettingsSchema.parse(res.json())).toMatchObject({
      registration_enabled: true,
      images_enabled: false,
      ha_enabled: false,
      ha_token: { set: false },
      timezone: "America/New_York",
    });
  });

  it("admins update everything except registration; only the owner toggles registration", async () => {
    const asAdmin = await request(t, "PATCH", "/api/settings", {
      cookie: roles.admin.cookie,
      body: {
        images_enabled: true,
        timezone: "Europe/Oslo",
        ha_enabled: true,
        ha_base_url: "http://ha.local:8123/",
      },
    });
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json()).toMatchObject({
      images_enabled: true,
      timezone: "Europe/Oslo",
      ha_enabled: true,
      ha_base_url: "http://ha.local:8123/",
    });

    const denied = await request(t, "PATCH", "/api/settings", {
      cookie: roles.admin.cookie,
      body: { registration_enabled: false },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe("owner_only");
    const mixed = await request(t, "PATCH", "/api/settings", {
      cookie: roles.admin.cookie,
      body: { registration_enabled: false, images_enabled: false },
    });
    expect(mixed.statusCode).toBe(403);
    expect(t.ctx.settings.get().images_enabled).toBe(true); // nothing applied

    const asOwner = await request(t, "PATCH", "/api/settings", {
      cookie: roles.owner.cookie,
      body: { registration_enabled: false },
    });
    expect(asOwner.statusCode).toBe(200);
    expect((await request(t, "GET", "/api/meta")).json().registration_enabled).toBe(false);
    expect(
      (
        await request(t, "PATCH", "/api/settings", {
          cookie: roles.user.cookie,
          body: { images_enabled: true },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("validates values and rejects unknown keys", async () => {
    for (const body of [
      {},
      { nope: 1 },
      { timezone: "Mars/Olympus" },
      { ha_base_url: "ftp://x" },
      { ha_token: "" },
      { images_enabled: "yes" },
    ]) {
      const res = await request(t, "PATCH", "/api/settings", { cookie: roles.admin.cookie, body });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it("never returns the HA token, and the event carries keys only", async () => {
    const events: unknown[] = [];
    t.ctx.events.on("settings.updated", (p) => events.push(p));

    const set = await request(t, "PATCH", "/api/settings", {
      cookie: roles.admin.cookie,
      body: { ha_token: "very-secret-token" },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().ha_token).toEqual({ set: true });
    expect(set.body).not.toContain("very-secret");
    const get = await request(t, "GET", "/api/settings", { cookie: roles.admin.cookie });
    expect(get.body).not.toContain("very-secret");
    expect(t.ctx.settings.getHaToken()).toBe("very-secret-token");

    const clear = await request(t, "PATCH", "/api/settings", {
      cookie: roles.admin.cookie,
      body: { ha_token: null },
    });
    expect(clear.json().ha_token).toEqual({ set: false });
    expect(events).toEqual([{ keys: ["ha_token"] }, { keys: ["ha_token"] }]);
    expect(JSON.stringify(events)).not.toContain("very-secret");
  });

  describe("POST /settings/ha/test", () => {
    let ha: Server | null = null;
    const seen: { path: string; auth: string | undefined }[] = [];
    const startHa = async (status: number) => {
      ha = createServer((req, res) => {
        seen.push({ path: req.url ?? "", auth: req.headers.authorization });
        req.resume();
        req.on("end", () => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end("{}");
        });
      });
      await new Promise<void>((r) => ha?.listen(0, "127.0.0.1", r));
      return `http://127.0.0.1:${(ha.address() as AddressInfo).port}`;
    };
    afterEach(async () => {
      if (ha) await new Promise<void>((r) => ha?.close(() => r()));
      ha = null;
      seen.length = 0;
    });

    it("is admin-only and refuses until URL and token are set", async () => {
      expect(
        (await request(t, "POST", "/api/settings/ha/test", { cookie: roles.user.cookie }))
          .statusCode,
      ).toBe(403);
      const res = await request(t, "POST", "/api/settings/ha/test", { cookie: roles.admin.cookie });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("ha_not_configured");
    });

    it("fires production_line_test with the stored token and reports HA's status", async () => {
      const url = await startHa(200);
      await request(t, "PATCH", "/api/settings", {
        cookie: roles.admin.cookie,
        body: { ha_base_url: url, ha_token: "llat-123" },
      });
      const res = await request(t, "POST", "/api/settings/ha/test", { cookie: roles.admin.cookie });
      expect(res.statusCode, res.body).toBe(200);
      expect(HaTestResultSchema.parse(res.json())).toEqual({ ok: true, status: 200, error: null });
      expect(seen).toEqual([{ path: "/api/events/production_line_test", auth: "Bearer llat-123" }]);
    });

    it("reports a rejected token as not ok with the status, still HTTP 200", async () => {
      const url = await startHa(401);
      await request(t, "PATCH", "/api/settings", {
        cookie: roles.admin.cookie,
        body: { ha_base_url: url, ha_token: "wrong" },
      });
      const res = await request(t, "POST", "/api/settings/ha/test", { cookie: roles.admin.cookie });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: false, status: 401, error: "HTTP 401" });
    });
  });
});
