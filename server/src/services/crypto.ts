import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";

interface ScryptOptions {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** scrypt parameters (dev doc §4, §9.2). Stored in each hash so they can be raised later. */
export const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const;
const KEY_LEN = 32;
const SALT_LEN = 32;

export interface ParsedPasswordHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function scryptMaxMem(N: number, r: number): number {
  // Node's default maxmem (32 MiB) is below what N=2^17, r=8 needs (128*N*r ≈ 134 MiB).
  return 128 * N * r * 2;
}

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = SCRYPT_PARAMS;
  const salt = randomBytes(SALT_LEN);
  const hash = await scrypt(password, salt, KEY_LEN, {
    N,
    r,
    p,
    maxmem: scryptMaxMem(N, r),
  });
  return ["scrypt", N, r, p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export function parsePasswordHash(stored: string): ParsedPasswordHash {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    throw new Error("malformed password hash");
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) {
    throw new Error("malformed password hash parameters");
  }
  const salt = Buffer.from(parts[4] as string, "base64");
  const hash = Buffer.from(parts[5] as string, "base64");
  if (salt.length === 0 || hash.length === 0) {
    throw new Error("malformed password hash encoding");
  }
  return { N, r, p, salt, hash };
}

/** Constant-time verification using the parameters stored in the hash. Never throws on bad input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  let parsed: ParsedPasswordHash;
  try {
    parsed = parsePasswordHash(stored);
  } catch {
    return false;
  }
  const { N, r, p, salt, hash } = parsed;
  const candidate = await scrypt(password, salt, hash.length, {
    N,
    r,
    p,
    maxmem: scryptMaxMem(N, r),
  });
  return candidate.length === hash.length && timingSafeEqual(candidate, hash);
}

const SECRET_VERSION = "v1";
const IV_LEN = 12;

/** AES-256-GCM. Output: "v1:<iv b64>:<tag b64>:<ciphertext b64>". */
export function encryptSecret(key: Buffer, plaintext: string): string {
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SECRET_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Throws if the payload is malformed, tampered with, or encrypted with a different key. */
export function decryptSecret(key: Buffer, payload: string): string {
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== SECRET_VERSION) {
    throw new Error("malformed encrypted secret");
  }
  const iv = Buffer.from(parts[1] as string, "base64");
  const tag = Buffer.from(parts[2] as string, "base64");
  const ciphertext = Buffer.from(parts[3] as string, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
