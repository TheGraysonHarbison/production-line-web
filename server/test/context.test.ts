import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { closeContext, createContext } from "../src/context.js";
import { bootstrapDataDir, SECRET_KEY_BYTES } from "../src/data-dir.js";
import { silentLog, tempDir } from "./helpers.js";

describe("DATA_DIR bootstrap", () => {
  let root: string;
  beforeEach(() => {
    root = join(tempDir(), "nested", "data");
  });
  afterEach(() => {
    rmSync(join(root, "..", ".."), { recursive: true, force: true });
  });

  it("creates app.db, images/, and a 0600 32-byte secret.key on first boot", () => {
    const ctx = createContext(loadConfig({ DATA_DIR: root, LOG_LEVEL: "silent" }), silentLog());
    closeContext(ctx);

    expect(existsSync(join(root, "app.db"))).toBe(true);
    expect(statSync(join(root, "images")).isDirectory()).toBe(true);
    const keyStat = statSync(join(root, "secret.key"));
    expect(keyStat.size).toBe(SECRET_KEY_BYTES);
    expect(keyStat.mode & 0o777).toBe(0o600);
  });

  it("reuses an existing key on the next boot", () => {
    const a = bootstrapDataDir(root);
    const b = bootstrapDataDir(root);
    expect(b.secretKey.equals(a.secretKey)).toBe(true);
    expect(b.secretKey.equals(readFileSync(join(root, "secret.key")))).toBe(true);
  });

  it("refuses a key of the wrong length", () => {
    bootstrapDataDir(root);
    writeFileSync(join(root, "secret.key"), Buffer.alloc(16));
    expect(() => bootstrapDataDir(root)).toThrow(/exactly 32 bytes/);
  });

  it("warns (but continues) when the key is world-readable", () => {
    bootstrapDataDir(root);
    chmodSync(join(root, "secret.key"), 0o644);
    bootstrapDataDir.warnings.length = 0;
    bootstrapDataDir(root);
    expect(bootstrapDataDir.warnings.some((w) => w.includes("permissive mode"))).toBe(true);
    bootstrapDataDir.warnings.length = 0;
  });
});
