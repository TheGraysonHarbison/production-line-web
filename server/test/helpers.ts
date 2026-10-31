import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { type App, buildApp } from "../src/app.js";
import { type Config, loadConfig } from "../src/config.js";
import { type AppContext, closeContext, createContext } from "../src/context.js";

export const silentLog = () => pino({ level: "silent" });

export function tempDir(prefix = "plw-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export interface TestContext {
  ctx: AppContext;
  root: string;
  cleanup: () => void;
}

/** A fresh DATA_DIR with migrations applied and defaults seeded. */
export function createTestContext(overrides: Partial<Config> = {}): TestContext {
  const root = tempDir();
  const config: Config = { ...loadConfig({ LOG_LEVEL: "silent", DATA_DIR: root }), ...overrides };
  const ctx = createContext(config, silentLog());
  return {
    ctx,
    root,
    cleanup: () => {
      try {
        closeContext(ctx);
      } catch {
        // already closed by app.close()
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export interface TestApp extends TestContext {
  app: App;
}

/** A ready Fastify app over a fresh DATA_DIR. `cleanup()` closes the app and deletes the dir. */
export async function createTestApp(options: { publicDir?: string } = {}): Promise<TestApp> {
  const tc = createTestContext();
  const app = await buildApp({ ctx: tc.ctx, publicDir: options.publicDir ?? "/nonexistent" });
  await app.ready();
  return {
    ...tc,
    app,
    cleanup: async () => {
      await app.close();
      tc.cleanup();
    },
  } as TestApp;
}
