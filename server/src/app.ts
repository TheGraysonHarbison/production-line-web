import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import fp from "fastify-plugin";
import type { AppContext } from "./context.js";
import { errorHandler } from "./errors.js";
import authPlugin from "./plugins/auth.js";
import securityPlugin from "./plugins/security.js";
import setupRedirectPlugin from "./plugins/setup-redirect.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { metaRoutes } from "./routes/meta.js";
import { printersRoutes } from "./routes/printers.js";
import { settingsRoutes } from "./routes/settings.js";
import { setupRoutes } from "./routes/setup.js";
import { slotsRoutes } from "./routes/slots.js";
import { streamRoutes } from "./routes/stream.js";
import { usersRoutes } from "./routes/users.js";

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
    // Open SSE connections must not keep close() waiting.
    forceCloseConnections: true,
  });

  // Expose the context to every plugin/route as a named plugin so dependencies can be declared.
  await app.register(
    fp(
      async (instance) => {
        instance.decorate("ctx", ctx);
        // Graceful shutdown (dev doc §3.4): finish the slot in flight, drop streams, close the DB.
        instance.addHook("onClose", async () => {
          await ctx.expiry.stop();
          ctx.broadcaster.stop();
          ctx.db.close();
        });
      },
      { name: "context" },
    ),
  );

  app.setErrorHandler(errorHandler);
  await app.register(securityPlugin);
  await app.register(authPlugin);
  await app.register(setupRedirectPlugin);

  await app.register(
    async (api) => {
      await api.register(metaRoutes);
      await api.register(setupRoutes);
      await api.register(authRoutes);
      await api.register(meRoutes);
      await api.register(usersRoutes);
      await api.register(printersRoutes);
      await api.register(settingsRoutes);
      await api.register(slotsRoutes);
      await api.register(streamRoutes);
    },
    { prefix: "/api" },
  );

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
