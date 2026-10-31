import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { forbidden } from "../errors.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Per-route rate-limit config for login/register (dev doc §9.4): 10/min/IP unless overridden for tests. */
export function authRateLimit(max: number) {
  return { max, timeWindow: "1 minute" } as const;
}

/**
 * Helmet (same-origin CSP, no HTTPS upgrades because v1 is plain HTTP), global rate limit,
 * and the Origin-based CSRF check for mutating routes (dev doc §7, §9.4, §9.8).
 */
const securityPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:", "blob:"],
        "font-src": ["'self'"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'self'"],
      },
    },
    strictTransportSecurity: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(fastifyRateLimit, {
    global: true,
    max: app.ctx.config.rateLimitMax,
    timeWindow: "1 minute",
    onExceeded: (request) => {
      request.log.warn({ ip: request.ip, url: request.url }, "auth.rate_limited");
    },
  });

  // CSRF: the cookie is SameSite=Lax, and in addition every mutating request must carry an
  // Origin that matches the host the server sees (honouring X-Forwarded-* when TRUST_PROXY=1).
  app.addHook("onRequest", async (request) => {
    if (!MUTATING.has(request.method)) return;
    const origin = request.headers.origin;
    if (!origin)
      throw forbidden("csrf_origin_missing", "mutating requests must include an Origin header");
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw forbidden("csrf_origin_invalid");
    }
    let expected: string;
    try {
      expected = new URL(`${request.protocol}://${request.host}`).origin;
    } catch {
      throw forbidden("csrf_host_invalid");
    }
    if (parsed.origin !== expected) {
      request.log.warn({ origin, expected }, "csrf.origin_mismatch");
      throw forbidden("csrf_origin_mismatch", "request origin does not match this server");
    }
  });
};

export default fp(securityPlugin, { name: "security", dependencies: ["context"] });
