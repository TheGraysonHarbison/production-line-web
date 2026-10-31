import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext } from "../src/context.js";
import type { AppEventMap } from "../src/events.js";
import { decryptSecret } from "../src/services/crypto.js";
import { createTestContext, silentLog, type TestContext } from "./helpers.js";

describe("SettingsService", () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });
  afterEach(() => {
    t.cleanup();
  });

  it("seeds defaults on boot", () => {
    expect(t.ctx.settings.get()).toEqual({
      registration_enabled: true,
      images_enabled: false,
      ha_enabled: false,
      ha_base_url: null,
      ha_token: { set: false },
      timezone: null,
    });
  });

  it("does not overwrite existing values when reseeding", () => {
    t.ctx.settings.update({ registration_enabled: false });
    t.ctx.settings.seedDefaults();
    expect(t.ctx.settings.get().registration_enabled).toBe(false);
  });

  it("encrypts ha_token at rest and never exposes it in the public view", () => {
    t.ctx.settings.update({ ha_token: "eyJhbGciOi.super.secret" });

    const row = t.ctx.db.prepare("SELECT value FROM settings WHERE key = 'ha_token'").get() as {
      value: string;
    };
    expect(row.value).not.toContain("super.secret");
    const stored = JSON.parse(row.value) as string;
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptSecret(t.ctx.dataDir.secretKey, stored)).toBe("eyJhbGciOi.super.secret");

    expect(t.ctx.settings.get().ha_token).toEqual({ set: true });
    expect(JSON.stringify(t.ctx.settings.get())).not.toContain("super.secret");
    expect(t.ctx.settings.getHaToken()).toBe("eyJhbGciOi.super.secret");
  });

  it("clears the token with null", () => {
    t.ctx.settings.update({ ha_token: "abc" });
    t.ctx.settings.update({ ha_token: null });
    expect(t.ctx.settings.get().ha_token).toEqual({ set: false });
    expect(t.ctx.settings.getHaToken()).toBeNull();
  });

  it("emits settings.updated with key names only", () => {
    const seen: AppEventMap["settings.updated"][] = [];
    t.ctx.events.on("settings.updated", (p) => seen.push(p));

    t.ctx.settings.update({
      ha_base_url: "http://ha.local:8123",
      ha_token: "tok",
      timezone: "America/New_York",
    });

    expect(seen).toEqual([{ keys: ["ha_base_url", "ha_token", "timezone"] }]);
    expect(JSON.stringify(seen)).not.toContain("s3cr3t");
    expect(t.ctx.settings.get()).toMatchObject({
      ha_base_url: "http://ha.local:8123",
      timezone: "America/New_York",
    });
  });

  it("ignores an empty patch without emitting", () => {
    let count = 0;
    t.ctx.events.on("settings.updated", () => count++);
    t.ctx.settings.update({});
    expect(count).toBe(0);
  });

  it("values survive reopening the database", () => {
    t.ctx.settings.update({ images_enabled: true, ha_token: "persisted" });
    t.ctx.db.close();
    const reopened = createContext(t.ctx.config, silentLog());
    expect(reopened.settings.get().images_enabled).toBe(true);
    expect(reopened.settings.getHaToken()).toBe("persisted");
    reopened.db.close();
  });
});
