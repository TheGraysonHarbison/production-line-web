import {
  IdSchema,
  type PublicUser,
  TransferOwnershipBodySchema,
  UpdateRoleBodySchema,
} from "@production-line/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../plugins/auth.js";
import { verifyPassword } from "../services/crypto.js";
import { toPublicUser } from "../services/users.js";

const ParamsSchema = z.object({ id: z.coerce.number().pipe(IdSchema) });

export const usersRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/users",
    { preHandler: requireAuth },
    async (): Promise<PublicUser[]> => app.ctx.users.list(),
  );

  app.patch(
    "/users/:id/role",
    { preHandler: requireRole("owner") },
    async (request): Promise<PublicUser> => {
      const { id } = ParamsSchema.parse(request.params);
      const { role } = UpdateRoleBodySchema.parse(request.body);
      const target = app.ctx.users.setRole(id, role);
      request.log.info({ by: request.user?.id, target: id, role }, "user.role_changed");
      return toPublicUser(target);
    },
  );

  app.post(
    "/users/:id/transfer-ownership",
    { preHandler: requireRole("owner") },
    async (request): Promise<PublicUser> => {
      const me = request.user as NonNullable<typeof request.user>;
      const { id } = ParamsSchema.parse(request.params);
      const { current_password } = TransferOwnershipBodySchema.parse(request.body);
      if (!(await verifyPassword(current_password, me.password_hash))) {
        throw new HttpError(403, "wrong_password", "current password is incorrect");
      }
      const { to } = app.ctx.users.transferOwnership(me.id, id);
      request.log.info({ from: me.id, to: to.id }, "user.ownership_transferred");
      return toPublicUser(to);
    },
  );

  app.delete("/users/:id", { preHandler: requireRole("owner") }, async (request, reply) => {
    const { id } = ParamsSchema.parse(request.params);
    const result = app.ctx.users.delete(id);
    request.log.info({ by: request.user?.id, target: id, ...result.cascaded }, "user.deleted");
    return reply.code(204).send();
  });
};
