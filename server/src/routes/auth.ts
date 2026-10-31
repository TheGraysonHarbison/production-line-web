import { LoginBodySchema, type Me, RegisterBodySchema } from "@production-line/shared";
import type { FastifyPluginAsync } from "fastify";
import { forbidden, HttpError } from "../errors.js";
import { requireAuth } from "../plugins/auth.js";
import { AUTH_RATE_LIMIT } from "../plugins/security.js";
import { hashPassword, verifyPassword } from "../services/crypto.js";
import { toMe } from "../services/users.js";

/** A real scrypt hash of a throwaway password, so unknown usernames cost the same as wrong passwords. */
let dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  dummyHash ??= await hashPassword("not-a-real-password");
  return dummyHash;
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/auth/register",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply): Promise<Me> => {
      if (app.ctx.users.count() === 0) {
        throw new HttpError(409, "setup_required", "complete first-boot setup before registering");
      }
      if (!app.ctx.settings.get().registration_enabled) {
        throw forbidden("registration_disabled", "registration is disabled");
      }
      const body = RegisterBodySchema.parse(request.body);
      const password_hash = await hashPassword(body.password);
      const user = app.ctx.users.create({
        username: body.username,
        password_hash,
        color: body.favorite_color,
        role: "user",
      });
      request.log.info({ userId: user.id, username: user.username }, "auth.registered");
      reply.startSession(user.id);
      return reply.code(201).send(toMe(user));
    },
  );

  app.post(
    "/auth/login",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply): Promise<Me> => {
      const body = LoginBodySchema.parse(request.body);
      const user = app.ctx.users.findByUsername(body.username);
      const ok = await verifyPassword(body.password, user?.password_hash ?? (await getDummyHash()));
      if (!user || !ok) {
        request.log.warn({ username: body.username, ip: request.ip }, "auth.login_failed");
        throw new HttpError(401, "invalid_credentials", "incorrect username or password");
      }
      reply.startSession(user.id);
      return toMe(user);
    },
  );

  app.post("/auth/logout", { preHandler: requireAuth }, async (_request, reply) => {
    reply.endSession();
    return reply.code(204).send();
  });
};
