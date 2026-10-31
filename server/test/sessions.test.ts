import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_TTL_MS, SessionsService } from "../src/services/sessions.js";
import { createTestContext, type TestContext } from "./helpers.js";

describe("SessionsService", () => {
  let t: TestContext;
  let sessions: SessionsService;
  beforeEach(() => {
    t = createTestContext();
    sessions = new SessionsService(t.ctx.db);
    t.ctx.db
      .prepare(
        "INSERT INTO users (username, password_hash, color, role, created_at) VALUES ('u', 'x', '#000000', 'owner', '2026-01-01T00:00:00.000Z')",
      )
      .run();
  });
  afterEach(() => t.cleanup());

  it("creates 32-byte base64url ids with a 30-day expiry", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const s = sessions.create(1, now);
    expect(Buffer.from(s.id, "base64url").length).toBe(32);
    expect(s.expires_at).toBe("2026-01-31T00:00:00.000Z");
  });

  it("slides the expiry forward only after an hour of use", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const s = sessions.create(1, now);
    const soon = sessions.resolve(s.id, new Date(now.getTime() + 10 * 60 * 1000));
    expect(soon?.session.expires_at).toBe(s.expires_at);
    const later = sessions.resolve(s.id, new Date(now.getTime() + 2 * 60 * 60 * 1000));
    expect(later?.session.expires_at).toBe(
      new Date(now.getTime() + 2 * 60 * 60 * 1000 + SESSION_TTL_MS).toISOString(),
    );
    expect(later?.user.username).toBe("u");
  });

  it("rejects and deletes expired sessions; purges in bulk", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const s = sessions.create(1, now);
    expect(sessions.resolve(s.id, new Date(now.getTime() + SESSION_TTL_MS + 1))).toBeNull();
    expect(sessions.resolve(s.id, now)).toBeNull();
    sessions.create(1, now);
    sessions.create(1, now);
    expect(sessions.purgeExpired(new Date(now.getTime() + SESSION_TTL_MS + 1))).toBe(2);
  });

  it("revokeAll keeps one session when asked", () => {
    const a = sessions.create(1);
    sessions.create(1);
    sessions.create(1);
    expect(sessions.revokeAll(1, a.id)).toBe(2);
    expect(sessions.resolve(a.id)).not.toBeNull();
    expect(sessions.revokeAll(1)).toBe(1);
  });
});
