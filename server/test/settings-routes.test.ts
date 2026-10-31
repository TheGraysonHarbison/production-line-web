import { PublicSettingsSchema } from "@production-line/shared";
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

  it("the HA test endpoint is reserved until delivery exists", async () => {
    expect(
      (await request(t, "POST", "/api/settings/ha/test", { cookie: roles.user.cookie })).statusCode,
    ).toBe(403);
    const res = await request(t, "POST", "/api/settings/ha/test", { cookie: roles.admin.cookie });
    expect(res.statusCode).toBe(501);
    expect(res.json().error).toBe("not_implemented");
  });
});
