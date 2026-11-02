import { type Me, UpdateMeBodySchema } from "@production-line/shared";
import type { FastifyPluginAsync } from "fastify";
import { HttpError } from "../errors.js";
import { requireAuth } from "../plugins/auth.js";
import { hashPassword, verifyPassword } from "../services/crypto.js";
import { toMe, type UpdateUserInput } from "../services/users.js";
import { assertImagesEnabled, filePart } from "./images.js";

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

  // Profile image (§3.8): replacing deletes the old file; removal clears it.
  app.put("/me/avatar", { preHandler: requireAuth }, async (request): Promise<Me> => {
    const user = request.user as NonNullable<typeof request.user>;
    assertImagesEnabled(app.ctx.settings.getValues().images_enabled);
    const part = await filePart(request);
    const image = await app.ctx.images.store({
      stream: part.file,
      originalName: part.filename,
      uploaderId: user.id,
      slotId: null,
    });
    const previous =
      user.avatar_image_id === null ? null : app.ctx.images.get(user.avatar_image_id);
    const updated = app.ctx.users.setAvatar(user.id, image.id);
    if (previous) {
      app.ctx.images.removeRow(previous.id);
      await app.ctx.images.unlinkFile(previous.stored_name);
    }
    request.log.info(
      { userId: user.id, image: image.id, replaced: previous?.id ?? null },
      "avatar.set",
    );
    return toMe(updated);
  });

  app.delete("/me/avatar", { preHandler: requireAuth }, async (request): Promise<Me> => {
    const user = request.user as NonNullable<typeof request.user>;
    const previous =
      user.avatar_image_id === null ? null : app.ctx.images.get(user.avatar_image_id);
    const updated = app.ctx.users.setAvatar(user.id, null);
    if (previous) {
      app.ctx.images.removeRow(previous.id);
      await app.ctx.images.unlinkFile(previous.stored_name);
    }
    request.log.info({ userId: user.id, removed: previous?.id ?? null }, "avatar.removed");
    return toMe(updated);
  });
};
