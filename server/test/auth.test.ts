import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/plugins/auth.js";
import { login, registerUser, request, sessionCookie, setupOwner } from "./auth-helpers.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("register / login / logout", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("refuses registration before setup", async () => {
    const res = await request(t, "POST", "/api/auth/register", {
      body: { username: "sam", password: "userpass1", favorite_color: "#000000" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("setup_required");
  });

  it("registers a plain user and signs them in", async () => {
    await setupOwner(t);
    const sam = await registerUser(t, "sam");
    expect(sam.me).toMatchObject({ username: "sam", role: "user", color: "#445566" });
    const me = await request(t, "GET", "/api/me", { cookie: sam.cookie });
    expect(me.json().id).toBe(sam.me.id);
  });

  it("rejects duplicate usernames case-insensitively", async () => {
    await setupOwner(t, "Owner");
    const res = await request(t, "POST", "/api/auth/register", {
      body: { username: "owner", password: "userpass1", favorite_color: "#000000" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("username_taken");
  });

  it("returns 403 when registration is disabled", async () => {
    await setupOwner(t);
    t.ctx.settings.update({ registration_enabled: false });
    const res = await request(t, "POST", "/api/auth/register", {
      body: { username: "sam", password: "userpass1", favorite_color: "#000000" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("registration_disabled");
  });

  it("logs in with the right password (case-insensitive username) and rejects the wrong one", async () => {
    await setupOwner(t, "Owner", "ownerpass1");
    const ok = await login(t, "owner", "ownerpass1");
    expect(ok.me.role).toBe("owner");

    const bad = await request(t, "POST", "/api/auth/login", {
      body: { username: "owner", password: "nope-nope" },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toBe("invalid_credentials");

    const unknown = await request(t, "POST", "/api/auth/login", {
      body: { username: "ghost", password: "whatever" },
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error).toBe("invalid_credentials");
  });

  it("logout deletes the session and clears the cookie", async () => {
    const owner = await setupOwner(t);
    const out = await request(t, "POST", "/api/auth/logout", { cookie: owner.cookie });
    expect(out.statusCode).toBe(204);
    const cleared = out.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cleared?.value).toBe("");
    const after = await request(t, "GET", "/api/me", { cookie: owner.cookie });
    expect(after.statusCode).toBe(401);
    expect(t.ctx.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("ignores forged or tampered session cookies", async () => {
    await setupOwner(t);
    const forged = await request(t, "GET", "/api/me", { cookie: `${SESSION_COOKIE}=abc.def` });
    expect(forged.statusCode).toBe(401);
    const session = t.ctx.sessions.create(1);
    const unsigned = await request(t, "GET", "/api/me", {
      cookie: `${SESSION_COOKIE}=${session.id}`,
    });
    expect(unsigned.statusCode).toBe(401);
  });

  it("rate-limits login at 10 per minute per IP", async () => {
    await setupOwner(t);
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request(t, "POST", "/api/auth/login", {
        body: { username: "owner", password: "wrong-pass" },
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
    const res = await request(t, "POST", "/api/auth/login", {
      body: { username: "owner", password: "ownerpass1" },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("rate_limited");
  });

  it("requires a matching Origin on mutating routes but not on GET", async () => {
    const owner = await setupOwner(t);
    const noOrigin = await request(t, "POST", "/api/auth/logout", {
      cookie: owner.cookie,
      origin: null,
    });
    expect(noOrigin.statusCode).toBe(403);
    const get = await request(t, "GET", "/api/me", { cookie: owner.cookie, origin: null });
    expect(get.statusCode).toBe(200);
  });

  it("sets security headers", async () => {
    const res = await request(t, "GET", "/api/meta");
    const csp = res.headers["content-security-policy"] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(res.headers["strict-transport-security"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("session cookie is validated and expired sessions are rejected", async () => {
    const owner = await setupOwner(t);
    expect(sessionCookie).toBeTypeOf("function");
    t.ctx.db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    const res = await request(t, "GET", "/api/me", { cookie: owner.cookie });
    expect(res.statusCode).toBe(401);
  });
});
