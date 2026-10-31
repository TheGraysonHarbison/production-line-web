import { type Me, UpdateMeBodySchema } from "@production-line/shared";
import type { FastifyPluginAsync } from "fastify";
import { forbidden, HttpError } from "../errors.js";
import { requireAuth } from "../plugins/auth.js";
import { hashPassword, verifyPassword } from "../services/crypto.js";
import { toMe, type UpdateUserInput } from "../services/users.js";

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", { preHandler: requireAuth }, async (request): Promise<Me> => {
    return toMe(request.user as NonNullable<typeof request.user>);
  });

  app.patch("/me", { preHandler: requireAuth }, async (request): Promise<Me> => {
    const user = request.user as NonNullable<typeof request.user>;
    const body = UpdateMeBodySchema.parse(request.body);
    const patch: UpdateUserInput = {};
    if (body.color !== undefined) patch.color = body.color;
    if (body.time_format !== undefined) patch.time_format = body.time_format;

    if (body.password !== undefined) {
      const ok = await verifyPassword(body.current_password as string, user.password_hash);
      if (!ok) throw new HttpError(403, "wrong_password", "current password is incorrect");
      patch.password_hash = await hashPassword(body.password);
    }

    const updated = app.ctx.users.update(user.id, patch);
    if (patch.password_hash) {
      // Every other session is revoked on password change (§9.1); the caller stays signed in.
      const revoked = app.ctx.sessions.revokeAll(user.id, request.session?.id);
      request.log.info({ userId: user.id, revoked }, "auth.password_changed");
    }
    return toMe(updated);
  });

  // Avatar upload/removal arrive with image support (Phase 9). Registered now so the API shape is stable.
  const imagesDisabled = async () => {
    throw forbidden("images_disabled", "image uploads are not enabled");
  };
  app.put("/me/avatar", { preHandler: requireAuth }, imagesDisabled);
  app.delete("/me/avatar", { preHandler: requireAuth }, imagesDisabled);
};
