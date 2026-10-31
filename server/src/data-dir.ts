import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SECRET_KEY_BYTES = 32;

export interface DataDir {
  root: string;
  dbPath: string;
  imagesDir: string;
  secretKeyPath: string;
  /** 32-byte AES-256 key protecting secrets at rest (dev doc §9.5). */
  secretKey: Buffer;
}

/**
 * Ensures DATA_DIR exists with its subdirectories and secret key (dev doc §4, §16).
 * Generates `secret.key` (mode 0600) on first boot; refuses to start if an existing key is
 * unreadable or the wrong length, since a bad key would silently break HA token decryption.
 */
export function bootstrapDataDir(root: string): DataDir {
  mkdirSync(root, { recursive: true });
  const imagesDir = join(root, "images");
  mkdirSync(imagesDir, { recursive: true });

  const secretKeyPath = join(root, "secret.key");
  let secretKey: Buffer;

  if (existsSync(secretKeyPath)) {
    try {
      secretKey = readFileSync(secretKeyPath);
    } catch (err) {
      throw new Error(`secret.key at ${secretKeyPath} is not readable: ${(err as Error).message}`);
    }
    if (secretKey.length !== SECRET_KEY_BYTES) {
      throw new Error(
        `secret.key at ${secretKeyPath} must be exactly ${SECRET_KEY_BYTES} bytes, found ${secretKey.length}. ` +
          "Restore it from a backup, or delete it to generate a new one (the HA token will need to be re-entered).",
      );
    }
    const mode = statSync(secretKeyPath).mode & 0o777;
    if (mode & 0o077) {
      // Not fatal: containers and some filesystems don't preserve modes. Caller may log it.
      bootstrapDataDir.warnings.push(
        `secret.key has permissive mode ${mode.toString(8)}; expected 0600`,
      );
    }
  } else {
    secretKey = randomBytes(SECRET_KEY_BYTES);
    writeFileSync(secretKeyPath, secretKey, { mode: 0o600, flag: "wx" });
  }

  return {
    root,
    dbPath: join(root, "app.db"),
    imagesDir,
    secretKeyPath,
    secretKey,
  };
}

/** Non-fatal observations collected during the last bootstrap; drained by the caller for logging. */
bootstrapDataDir.warnings = [] as string[];
