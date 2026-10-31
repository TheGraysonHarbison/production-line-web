/**
 * Environment configuration (dev doc §13).
 * Phase 0 reads only what the skeleton needs; Phase 1 adds DATA_DIR, TRUST_PROXY, and validation.
 */
export interface Config {
  port: number;
  host: string;
  logLevel: string;
}

const LOG_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

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

  return {
    port,
    host: env.HOST ?? "0.0.0.0",
    logLevel,
  };
}
