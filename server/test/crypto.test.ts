import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  parsePasswordHash,
  SCRYPT_PARAMS,
  verifyPassword,
} from "../src/services/crypto.js";

describe("password hashing (scrypt)", () => {
  it("produces the documented format with the documented parameters", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(
      stored.startsWith(`scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$`),
    ).toBe(true);
    const parsed = parsePasswordHash(stored);
    expect(parsed.N).toBe(2 ** 17);
    expect(parsed.r).toBe(8);
    expect(parsed.p).toBe(1);
    expect(parsed.salt.length).toBe(32);
    expect(parsed.hash.length).toBe(32);
  });

  it("uses a fresh salt per hash", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });

  it("verifies the right password and rejects the wrong one", async () => {
    const stored = await hashPassword("hunter22");
    expect(await verifyPassword("hunter22", stored)).toBe(true);
    expect(await verifyPassword("hunter2", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("verifies hashes made with other (stored) parameters", async () => {
    // Simulate an older/cheaper hash: parameters come from the string, not the constants.
    const stored = await hashPassword("pw");
    const cheap = stored.replace(`$${SCRYPT_PARAMS.N}$`, "$16384$");
    // Different N means a different hash, so verification must fail rather than crash.
    expect(await verifyPassword("pw", cheap)).toBe(false);
  });

  it("never throws on malformed stored hashes", async () => {
    expect(await verifyPassword("pw", "")).toBe(false);
    expect(await verifyPassword("pw", "bcrypt$x")).toBe(false);
    expect(await verifyPassword("pw", "scrypt$a$b$c$d$e")).toBe(false);
    expect(() => parsePasswordHash("nope")).toThrow(/malformed/);
  });
});

describe("secret encryption (AES-256-GCM)", () => {
  const key = randomBytes(32);

  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret(key, "long-lived-token");
    const b = encryptSecret(key, "long-lived-token");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(decryptSecret(key, a)).toBe("long-lived-token");
    expect(decryptSecret(key, b)).toBe("long-lived-token");
    expect(a).not.toContain("long-lived-token");
  });

  it("handles empty and unicode plaintext", () => {
    expect(decryptSecret(key, encryptSecret(key, ""))).toBe("");
    expect(decryptSecret(key, encryptSecret(key, "tøkén 🔑"))).toBe("tøkén 🔑");
  });

  it("detects tampering", () => {
    const payload = encryptSecret(key, "secret");
    const parts = payload.split(":");
    const ct = Buffer.from(parts[3] as string, "base64");
    ct[0] = (ct[0] as number) ^ 0xff;
    parts[3] = ct.toString("base64");
    expect(() => decryptSecret(key, parts.join(":"))).toThrow();
  });

  it("rejects a different key and malformed payloads", () => {
    const payload = encryptSecret(key, "secret");
    expect(() => decryptSecret(randomBytes(32), payload)).toThrow();
    expect(() => decryptSecret(key, "v0:a:b:c")).toThrow(/malformed/);
    expect(() => decryptSecret(key, "garbage")).toThrow(/malformed/);
    expect(() => encryptSecret(randomBytes(16), "x")).toThrow(/32 bytes/);
  });
});
