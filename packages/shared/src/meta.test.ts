import { describe, expect, it } from "vitest";
import { MetaSchema } from "./meta.js";

describe("MetaSchema", () => {
  it("accepts a valid meta object", () => {
    const parsed = MetaSchema.parse({
      setup_required: true,
      registration_enabled: true,
      images_enabled: false,
      timezone: "UTC",
    });
    expect(parsed.timezone).toBe("UTC");
  });

  it("rejects a missing field", () => {
    expect(() => MetaSchema.parse({ setup_required: true })).toThrow();
  });
});
