import type { Meta } from "@production-line/shared";
import type { FastifyPluginAsync } from "fastify";

/**
 * GET /api/meta — public metadata and health check (dev doc §7, §17).
 * `timezone` falls back to UTC until first-boot setup records the real one.
 */
export const metaRoutes: FastifyPluginAsync = async (app) => {
  const countUsers = app.ctx.db.prepare("SELECT COUNT(*) AS n FROM users");

  app.get("/meta", async (): Promise<Meta> => {
    const { n } = countUsers.get() as { n: number };
    const settings = app.ctx.settings.get();
    return {
      setup_required: n === 0,
      registration_enabled: settings.registration_enabled,
      images_enabled: settings.images_enabled,
      timezone: settings.timezone ?? "UTC",
    };
  });
};
