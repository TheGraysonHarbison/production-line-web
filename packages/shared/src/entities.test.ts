import { describe, expect, it } from "vitest";
import { HexColorSchema, IsoDateTimeSchema } from "./common.js";
import { PublicSettingsSchema } from "./settings.js";

describe("common schemas", () => {
  it("normalises hex colors to lowercase", () => {
    expect(HexColorSchema.parse("#4F9CFF")).toBe("#4f9cff");
    expect(() => HexColorSchema.parse("4f9cff")).toThrow();
    expect(() => HexColorSchema.parse("#fff")).toThrow();
  });

  it("accepts ISO-8601 UTC timestamps", () => {
    expect(IsoDateTimeSchema.parse("2026-11-02T18:00:00.000Z")).toBe("2026-11-02T18:00:00.000Z");
    expect(() => IsoDateTimeSchema.parse("2026-11-02 18:00")).toThrow();
  });
});

describe("PublicSettingsSchema", () => {
  it("never carries a token value", () => {
    const parsed = PublicSettingsSchema.parse({
      registration_enabled: true,
      images_enabled: false,
      ha_enabled: false,
      ha_base_url: null,
      ha_token: { set: false },
      timezone: null,
    });
    expect(parsed.ha_token).toEqual({ set: false });
    expect(() => PublicSettingsSchema.parse({ ...parsed, ha_token: "secret" })).toThrow();
  });
});
