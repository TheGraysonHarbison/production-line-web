import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

/**
 * First boot (dev doc §3.7): until an Owner exists, HTML navigations go to /setup.
 * API calls and static assets are untouched; the API's own auth already answers 401.
 */
const setupRedirectPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "GET") return;
    const path = request.url.split("?")[0] ?? "/";
    if (path === "/setup" || path.startsWith("/api/") || path === "/api") return;
    if (/\.[a-z0-9]+$/i.test(path)) return; // static asset
    const accept = request.headers.accept ?? "";
    if (!accept.includes("text/html")) return;
    if (app.ctx.users.count() > 0) return;
    return reply.redirect("/setup", 302);
  });
};

export default fp(setupRedirectPlugin, { name: "setup-redirect" });
