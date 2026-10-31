import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import { metaRoutes } from "./routes/meta.js";

export interface BuildAppOptions {
  config: Config;
  /** Directory holding the built SPA. Defaults to `server/public`. */
  publicDir?: string;
}

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Builds the Fastify application without listening, so tests can use `app.inject()`.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: options.config.logLevel },
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
