import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../plugins/auth.js";

/**
 * GET /api/stream — Server-Sent Events for every authenticated session (dev doc §4, §5).
 * The reply is hijacked so the socket stays open; the Broadcaster owns it from here.
 */
export const streamRoutes: FastifyPluginAsync = async (app) => {
  app.get("/stream", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user as NonNullable<typeof request.user>;
    const session = request.session as NonNullable<typeof request.session>;

    reply.hijack();
    const headers = {
      ...reply.getHeaders(),
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    };
    reply.raw.writeHead(200, headers as Record<string, string>);
    reply.raw.flushHeaders();

    const client = app.ctx.broadcaster.add(reply.raw, user.id, session.id);
    request.log.debug({ userId: user.id, clients: app.ctx.broadcaster.size }, "stream.opened");
    request.raw.on("close", () => {
      app.ctx.broadcaster.remove(client);
      request.log.debug({ userId: user.id, clients: app.ctx.broadcaster.size }, "stream.closed");
    });
  });
};
