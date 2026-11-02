import fastifyCookie from "@fastify/cookie";
import { IdSchema, type Role, type Slot } from "@production-line/shared";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { forbidden, unauthorized } from "../errors.js";
import type { SessionRow } from "../services/sessions.js";
import { roleSatisfies, type UserRow } from "../services/users.js";

export const SESSION_COOKIE = "plw_session";
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

declare module "fastify" {
  interface FastifyRequest {
    user: UserRow | null;
    session: SessionRow | null;
    /** Set by requireSlotAccess(). */
    slot: Slot | null;
  }
  interface FastifyReply {
    startSession(userId: number): void;
    endSession(): void;
  }
}

/**
 * Session cookie + request.user (dev doc §9.1). The cookie is signed with a key derived from
 * DATA_DIR/secret.key, httpOnly, SameSite=Lax, Path=/; not `Secure` in v1 (plain HTTP on a LAN).
 */
const authPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyCookie, {
    secret: app.ctx.dataDir.secretKey.toString("hex"),
  });

  app.decorateRequest("user", null);
  app.decorateRequest("session", null);
  app.decorateRequest("slot", null);

  app.decorateReply("startSession", function (this: FastifyReply, userId: number) {
    const session = app.ctx.sessions.create(userId);
    this.setCookie(SESSION_COOKIE, session.id, {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE_S,
    });
    this.request.session = session;
  });

  app.decorateReply("endSession", function (this: FastifyReply) {
    const current = this.request.session;
    if (current) app.ctx.sessions.delete(current.id);
    this.clearCookie(SESSION_COOKIE, { path: "/" });
    this.request.session = null;
    this.request.user = null;
  });

  app.addHook("onRequest", async (request) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    const resolved = app.ctx.sessions.resolve(unsigned.value);
    if (!resolved) return;
    request.session = resolved.session;
    request.user = resolved.user;
  });
};

export default fp(authPlugin, { name: "auth", dependencies: ["context"] });

/** preHandler: 401 unless a valid session is attached. */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.user) throw unauthorized();
}

/** preHandler factory: 401 without a session, 403 below the required role. Owner satisfies admin. */
export function requireRole(role: Role) {
  const guard = async (request: FastifyRequest): Promise<void> => {
    if (!request.user) throw unauthorized();
    if (!roleSatisfies(request.user.role, role)) throw forbidden("insufficient_role");
  };
  // Named so the route-coverage audit can tell guards from other preHandlers.
  return Object.defineProperty(guard, "name", { value: `requireRole:${role}` });
}

const SlotParams = z.object({ id: z.coerce.number().pipe(IdSchema) });

/**
 * preHandler factory for /api/slots/:id mutations (dev doc §3.3): the slot's user, Admins, and the
 * Owner may proceed; everyone else gets 403. Loads the slot onto `request.slot` (404 if missing).
 */
export function requireSlotAccess() {
  const guard = async (request: FastifyRequest): Promise<void> => {
    if (!request.user) throw unauthorized();
    const { id } = SlotParams.parse(request.params);
    const slot = request.server.ctx.slots.get(id);
    const allowed = slot.user.id === request.user.id || roleSatisfies(request.user.role, "admin");
    if (!allowed)
      throw forbidden("not_slot_owner", "only the slot's owner or an admin may change it");
    request.slot = slot;
  };
  return Object.defineProperty(guard, "name", { value: "requireSlotAccess" });
}
