import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Override when something else holds 8080 on the dev host (same spirit as PLW_E2E_DATA_DIR).
const PORT = Number(process.env.PLW_E2E_PORT ?? 8080);
// Every e2e run starts from a fresh, empty DATA_DIR so the first-boot flow is testable.
const DATA_DIR = process.env.PLW_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), "plw-e2e-"));

const viewport = (name: string, use: Record<string, unknown>) => ({
  name,
  use: { ...devices["Desktop Chrome"], ...use },
  dependencies: ["setup"],
  testIgnore: /(setup|admin)\.spec\.ts/,
});

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /setup\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    viewport("desktop", { viewport: { width: 1280, height: 800 } }),
    viewport("tablet", { viewport: { width: 768, height: 1024 }, hasTouch: true }),
    viewport("mobile", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }),
    // Admin flows mutate global state (registration toggle, timezone), so they run alone, afterwards.
    {
      name: "admin",
      testMatch: /admin\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
      dependencies: ["desktop", "tablet", "mobile"],
      fullyParallel: false,
    },
  ],
  webServer: {
    command: "npm run start",
    cwd: "..",
    url: `http://localhost:${PORT}/api/meta`,
    reuseExistingServer: false,
    timeout: 30_000,
    // All browser contexts share one IP, so the per-IP backstop must not throttle the suite.
    env: {
      DATA_DIR,
      PORT: String(PORT),
      LOG_LEVEL: "warn",
      RATE_LIMIT_MAX: "100000",
      RATE_LIMIT_AUTH_MAX: "100000",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
