import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { AppContext } from "./context.js";
import { metaRoutes } from "./routes/meta.js";

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

/** The concrete app type (Fastify instance with our pino logger). */
export type App = Awaited<ReturnType<typeof buildApp>>;

export interface BuildAppOptions {
  ctx: AppContext;
  /** Directory holding the built SPA. Defaults to `server/public`. */
  publicDir?: string;
}

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Builds the Fastify application without listening, so tests can use `app.inject()`.
 * Closing the app closes the database.
 */
export async function buildApp(options: BuildAppOptions) {
  const { ctx } = options;
  const app = Fastify({
    loggerInstance: ctx.log,
    trustProxy: ctx.config.trustProxy,
  });

  app.decorate("ctx", ctx);
  app.addHook("onClose", async () => {
    ctx.db.close();
  });

  await app.register(metaRoutes, { prefix: "/api" });

  const publicDir = options.publicDir ?? join(here, "..", "public");
  const hasClient = existsSync(join(publicDir, "index.html"));

  if (hasClient) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: "/",
      wildcard: false,
      index: ["index.html"],
    });
  } else {
    app.log.warn({ publicDir }, "no built client found; serving API only");
  }

  // Unknown /api paths are JSON 404s, never the SPA shell.
  // Any other GET falls back to index.html so client-side routes deep-link correctly.
  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === "/api" || request.url.startsWith("/api/");
    if (hasClient && !isApi && request.method === "GET") {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not_found" });
  });

  return app;
}
