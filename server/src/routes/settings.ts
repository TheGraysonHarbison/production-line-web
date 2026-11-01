import {
  type HaTestResult,
  type PublicSettings,
  UpdateSettingsBodySchema,
} from "@production-line/shared";
import type { FastifyPluginAsync } from "fastify";
import { forbidden } from "../errors.js";
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

  // Fires `production_line_test` once and reports what Home Assistant answered (dev doc §7).
  app.post(
    "/settings/ha/test",
    { preHandler: requireRole("admin") },
    async (request): Promise<HaTestResult> => {
      const r = await app.ctx.ha.test();
      request.log.info(
        { by: request.user?.id, httpStatus: r.httpStatus, ok: r.status === "sent" },
        "ha.test",
      );
      return { ok: r.status === "sent", status: r.httpStatus, error: r.error };
    },
  );
};
