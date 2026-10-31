import { describe, expect, it } from "vitest";
import { CreatePrinterBodySchema, UpdatePrinterBodySchema } from "./printers.js";
import { UpdateSettingsBodySchema } from "./settings.js";

describe("printer schemas", () => {
  it("trims and bounds the name", () => {
    expect(CreatePrinterBodySchema.parse({ name: "  Prusa MK4 " })).toEqual({ name: "Prusa MK4" });
    expect(() => CreatePrinterBodySchema.parse({ name: "   " })).toThrow();
    expect(() => CreatePrinterBodySchema.parse({ name: "x".repeat(65) })).toThrow();
  });
  it("update requires at least one field", () => {
    expect(() => UpdatePrinterBodySchema.parse({})).toThrow(/nothing/);
    expect(UpdatePrinterBodySchema.parse({ invisible: true })).toEqual({ invisible: true });
  });
});

describe("UpdateSettingsBodySchema", () => {
  it("accepts http(s) base URLs and nulls, rejects others", () => {
    expect(
      UpdateSettingsBodySchema.parse({ ha_base_url: "http://homeassistant.local:8123" })
        .ha_base_url,
    ).toBe("http://homeassistant.local:8123");
    expect(UpdateSettingsBodySchema.parse({ ha_base_url: null }).ha_base_url).toBeNull();
    expect(() => UpdateSettingsBodySchema.parse({ ha_base_url: "ftp://x" })).toThrow();
    expect(() => UpdateSettingsBodySchema.parse({ ha_base_url: "not a url" })).toThrow();
  });
  it("rejects unknown keys, empty bodies, and bad timezones", () => {
    expect(() => UpdateSettingsBodySchema.parse({})).toThrow(/nothing/);
    expect(() => UpdateSettingsBodySchema.parse({ nope: true })).toThrow();
    expect(() => UpdateSettingsBodySchema.parse({ timezone: "Mars/Olympus" })).toThrow();
    expect(UpdateSettingsBodySchema.parse({ timezone: "Europe/Oslo", ha_token: null })).toEqual({
      timezone: "Europe/Oslo",
      ha_token: null,
    });
  });
});
