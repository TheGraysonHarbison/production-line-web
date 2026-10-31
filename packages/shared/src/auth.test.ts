import { describe, expect, it } from "vitest";
import { PasswordSchema, SetupBodySchema, UpdateMeBodySchema, UsernameSchema } from "./auth.js";
import { TimeZoneSchema } from "./common.js";

describe("UsernameSchema", () => {
  it("accepts 3–32 chars of the allowed set", () => {
    expect(UsernameSchema.parse("sam")).toBe("sam");
    expect(UsernameSchema.parse("a.b-c_D9")).toBe("a.b-c_D9");
    expect(UsernameSchema.parse("x".repeat(32))).toHaveLength(32);
  });
  it("rejects bad lengths and characters", () => {
    expect(() => UsernameSchema.parse("ab")).toThrow();
    expect(() => UsernameSchema.parse("x".repeat(33))).toThrow();
    expect(() => UsernameSchema.parse("sam smith")).toThrow();
    expect(() => UsernameSchema.parse("sam@home")).toThrow();
  });
});

describe("PasswordSchema", () => {
  it("enforces 8–128 only", () => {
    expect(PasswordSchema.parse("12345678")).toBe("12345678");
    expect(PasswordSchema.parse("x".repeat(128))).toHaveLength(128);
    expect(() => PasswordSchema.parse("1234567")).toThrow();
    expect(() => PasswordSchema.parse("x".repeat(129))).toThrow();
  });
});

describe("TimeZoneSchema", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(TimeZoneSchema.parse("America/New_York")).toBe("America/New_York");
    expect(TimeZoneSchema.parse("UTC")).toBe("UTC");
    expect(() => TimeZoneSchema.parse("Mars/Olympus")).toThrow();
    expect(() => TimeZoneSchema.parse("")).toThrow();
  });
});

describe("SetupBodySchema / UpdateMeBodySchema", () => {
  it("setup allows an optional timezone", () => {
    const parsed = SetupBodySchema.parse({
      username: "owner",
      password: "password1",
      favorite_color: "#4F9CFF",
    });
    expect(parsed.timezone).toBeUndefined();
    expect(parsed.favorite_color).toBe("#4f9cff");
  });
  it("password change requires current_password", () => {
    expect(() => UpdateMeBodySchema.parse({ password: "newpassword" })).toThrow(/current_password/);
    expect(
      UpdateMeBodySchema.parse({ password: "newpassword", current_password: "old" }).password,
    ).toBe("newpassword");
    expect(UpdateMeBodySchema.parse({ time_format: "24h" }).time_format).toBe("24h");
  });
});
