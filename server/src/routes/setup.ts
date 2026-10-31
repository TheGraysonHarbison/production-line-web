import { type Me, SetupBodySchema } from "@production-line/shared";
import type { FastifyPluginAsync } from "fastify";
import { HttpError } from "../errors.js";
import { hashPassword } from "../services/crypto.js";
import { toMe } from "../services/users.js";

/** POST /api/setup — creates the Owner once, records the browser's timezone, logs them in (§3.7). */
export const setupRoutes: FastifyPluginAsync = async (app) => {
  app.post("/setup", async (request, reply): Promise<Me> => {
    if (app.ctx.users.count() > 0) {
      throw new HttpError(409, "setup_complete", "setup has already been completed");
    }
    const body = SetupBodySchema.parse(request.body);
    const password_hash = await hashPassword(body.password);

    // Re-check inside the critical section: the hash above is slow and two first visitors could race.
    if (app.ctx.users.count() > 0) {
      throw new HttpError(409, "setup_complete", "setup has already been completed");
    }
    const owner = app.ctx.users.create({
      username: body.username,
      password_hash,
      color: body.favorite_color,
      role: "owner",
    });
    if (body.timezone && app.ctx.settings.get().timezone === null) {
      app.ctx.settings.update({ timezone: body.timezone });
    }
    request.log.info({ userId: owner.id, username: owner.username }, "setup.owner_created");
    reply.startSession(owner.id);
    return reply.code(201).send(toMe(owner));
  });
};
