import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { IMAGE_MAX_BYTES } from "@production-line/shared";
import Fastify from "fastify";
import fp from "fastify-plugin";
import type { AppContext } from "./context.js";
import { closeDatabase } from "./db/connection.js";
import { errorHandler } from "./errors.js";
import authPlugin from "./plugins/auth.js";
import securityPlugin from "./plugins/security.js";
import setupRedirectPlugin from "./plugins/setup-redirect.js";
import { authRoutes } from "./routes/auth.js";
import { backupRoutes } from "./routes/backup.js";
import { imagesRoutes } from "./routes/images.js";
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

export interface RegisteredRoute {
  method: string;
  url: string;
  preHandler: unknown[];
}

export interface BuildAppOptions {
  ctx: AppContext;
  /** Directory holding the built SPA. Defaults to `server/public`. */
  publicDir?: string;
  /** Test hook: sees every route as it is registered (the route-coverage audit uses it). */
  onRoute?: (route: RegisteredRoute) => void;
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
          closeDatabase(ctx.db);
        });
      },
      { name: "context" },
    ),
  );

  if (options.onRoute) {
    const report = options.onRoute;
    app.addHook("onRoute", (route) => {
      const pre = route.preHandler;
      const list = pre === undefined ? [] : Array.isArray(pre) ? pre : [pre];
      for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
        report({ method, url: route.url, preHandler: list });
      }
    });
  }

  app.setErrorHandler(errorHandler);
  await app.register(securityPlugin);
  await app.register(authPlugin);
  await app.register(setupRedirectPlugin);
  // Uploads (§9.7): one file per request, capped at the multipart layer so nothing past 10 MB is
  // buffered; the parser errors the stream and the route answers 413.
  await app.register(fastifyMultipart, {
    limits: { fileSize: IMAGE_MAX_BYTES, files: 1, fields: 4, parts: 5 },
    throwFileSizeLimit: true,
  });

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
      await api.register(imagesRoutes);
      await api.register(backupRoutes);
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
