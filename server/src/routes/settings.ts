import { type PublicSettings, UpdateSettingsBodySchema } from "@production-line/shared";
import type { FastifyPluginAsync } from "fastify";
import { forbidden, HttpError } from "../errors.js";
import { requireRole } from "../plugins/auth.js";

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/settings", { preHandler: requireRole("admin") }, async (): Promise<PublicSettings> => {
    return app.ctx.settings.get();
  });

  app.patch(
    "/settings",
    { preHandler: requireRole("admin") },
    async (request): Promise<PublicSettings> => {
      const body = UpdateSettingsBodySchema.parse(request.body);
      if (body.registration_enabled !== undefined && request.user?.role !== "owner") {
        throw forbidden("owner_only", "only the Owner can toggle registration");
      }
      const updated = app.ctx.settings.update(body);
      request.log.info({ by: request.user?.id, keys: Object.keys(body) }, "settings.updated");
      return updated;
    },
  );

  // Fires a test event at Home Assistant once the HA client exists (Phase 8).
  app.post("/settings/ha/test", { preHandler: requireRole("admin") }, async () => {
    throw new HttpError(
      501,
      "not_implemented",
      "Home Assistant delivery arrives in a later version",
    );
  });
};
