import { resolve } from "node:path";

/**
 * Environment configuration (dev doc §13).
 */
export interface Config {
  port: number;
  host: string;
  logLevel: string;
  /** Absolute path holding app.db, secret.key, and images/. */
  dataDir: string;
  /** Honour X-Forwarded-* headers from a reverse proxy. */
  trustProxy: boolean;
  /** Global per-IP rate limit per minute (dev doc §9.4 backstop). Override is for test suites only. */
  rateLimitMax: number;
  /** Login/register attempts per minute per IP (dev doc §9.4). Override is for test suites only. */
  rateLimitAuthMax: number;
  /** SSE heartbeat interval override (tests only; unset in production). */
  streamHeartbeatMs?: number;
}

const LOG_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

function parseBool(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  throw new Error(`${name} must be 0 or 1, got "${raw}"`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const portRaw = env.PORT ?? "8080";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${portRaw}"`);
  }

  const logLevel = env.LOG_LEVEL ?? "info";
  if (!LOG_LEVELS.has(logLevel)) {
    throw new Error(`LOG_LEVEL must be one of ${[...LOG_LEVELS].join(", ")}, got "${logLevel}"`);
  }

  const dataDirRaw = env.DATA_DIR ?? "./data";
  if (dataDirRaw.trim() === "") {
    throw new Error("DATA_DIR must not be empty");
  }

  const positiveInt = (name: string, raw: string | undefined, fallback: number): number => {
    const value = Number(raw ?? String(fallback));
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer, got "${raw}"`);
    }
    return value;
  };
  const rateLimitMax = positiveInt("RATE_LIMIT_MAX", env.RATE_LIMIT_MAX, 300);
  const rateLimitAuthMax = positiveInt("RATE_LIMIT_AUTH_MAX", env.RATE_LIMIT_AUTH_MAX, 10);

  return {
    port,
    host: env.HOST ?? "0.0.0.0",
    logLevel,
    dataDir: resolve(dataDirRaw),
    trustProxy: parseBool("TRUST_PROXY", env.TRUST_PROXY, false),
    rateLimitMax,
    rateLimitAuthMax,
  };
}
