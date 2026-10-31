import { MeSchema } from "@production-line/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/plugins/auth.js";
import { ORIGIN, request, sessionCookie, setupOwner } from "./auth-helpers.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("first boot / POST /api/setup", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("creates the Owner, records the timezone, and signs them in", async () => {
    const res = await request(t, "POST", "/api/setup", {
      body: {
        username: "Grayson",
        password: "ownerpass1",
        favorite_color: "#ABCDEF",
        timezone: "Europe/Oslo",
      },
    });
    expect(res.statusCode).toBe(201);
    const me = MeSchema.parse(res.json());
    expect(me).toMatchObject({
      username: "Grayson",
      role: "owner",
      color: "#abcdef",
      time_format: "12h",
    });

    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.secure).toBeFalsy();

    const meRes = await request(t, "GET", "/api/me", { cookie: sessionCookie(res) });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().username).toBe("Grayson");

    const meta = await request(t, "GET", "/api/meta");
    expect(meta.json()).toMatchObject({ setup_required: false, timezone: "Europe/Oslo" });
  });

  it("validates the body with field-level issues", async () => {
    const res = await request(t, "POST", "/api/setup", {
      body: { username: "ab", password: "short", favorite_color: "blue" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("validation");
    const fields = body.issues.map((i: { path: unknown[] }) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["username", "password", "favorite_color"]));
  });

  it("rejects an invalid timezone but accepts none", async () => {
    const bad = await request(t, "POST", "/api/setup", {
      body: {
        username: "owner",
        password: "ownerpass1",
        favorite_color: "#000000",
        timezone: "Mars/Olympus",
      },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await request(t, "POST", "/api/setup", {
      body: { username: "owner", password: "ownerpass1", favorite_color: "#000000" },
    });
    expect(ok.statusCode).toBe(201);
    expect((await request(t, "GET", "/api/meta")).json().timezone).toBe("UTC");
  });

  it("is refused once a user exists", async () => {
    await setupOwner(t);
    const res = await request(t, "POST", "/api/setup", {
      body: { username: "second", password: "ownerpass1", favorite_color: "#000000" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("setup_complete");
  });

  it("redirects HTML navigations to /setup until an Owner exists, and not after", async () => {
    const before = await t.app.inject({
      method: "GET",
      url: "/",
      headers: { accept: "text/html" },
    });
    expect(before.statusCode).toBe(302);
    expect(before.headers.location).toBe("/setup");
    const deep = await t.app.inject({
      method: "GET",
      url: "/settings/profile",
      headers: { accept: "text/html" },
    });
    expect(deep.statusCode).toBe(302);
    // /setup itself, assets, and API calls are not redirected.
    expect(
      (await t.app.inject({ method: "GET", url: "/setup", headers: { accept: "text/html" } }))
        .statusCode,
    ).not.toBe(302);
    expect(
      (await t.app.inject({ method: "GET", url: "/assets/app.js", headers: { accept: "*/*" } }))
        .statusCode,
    ).toBe(404);
    expect((await t.app.inject({ method: "GET", url: "/api/meta" })).statusCode).toBe(200);

    await setupOwner(t);
    const after = await t.app.inject({ method: "GET", url: "/", headers: { accept: "text/html" } });
    expect(after.statusCode).not.toBe(302);
  });

  it("enforces the CSRF Origin check on setup too", async () => {
    const missing = await request(t, "POST", "/api/setup", {
      body: { username: "owner", password: "ownerpass1", favorite_color: "#000000" },
      origin: null,
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error).toBe("csrf_origin_missing");
    const wrong = await request(t, "POST", "/api/setup", {
      body: { username: "owner", password: "ownerpass1", favorite_color: "#000000" },
      origin: "http://evil.example",
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe("csrf_origin_mismatch");
    expect(ORIGIN).toBe("http://localhost:80");
  });
});
