import type { Meta } from "@production-line/shared";
import type { FastifyPluginAsync } from "fastify";

/**
 * GET /api/meta — public metadata and health check (dev doc §7, §17).
 * Phase 0 returns static values; Phase 1 reads them from the database.
 */
export const metaRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/meta",
    async (): Promise<Meta> => ({
      setup_required: true,
      registration_enabled: true,
      images_enabled: false,
      timezone: "UTC",
    }),
  );
};
