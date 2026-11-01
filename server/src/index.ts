import pino from "pino";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createContext } from "./context.js";

const config = loadConfig();
const log = pino({ level: config.logLevel });

let app: Awaited<ReturnType<typeof buildApp>>;
let ctx: ReturnType<typeof createContext>;
try {
  ctx = createContext(config, log);
  app = await buildApp({ ctx });
} catch (err) {
  log.fatal({ err }, "startup failed");
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Catch-up pass for slots that expired while we were down, then the 30 s tick (dev doc §3.4).
// Not awaited: a slow Home Assistant must not delay serving requests.
void ctx.expiry.start();
