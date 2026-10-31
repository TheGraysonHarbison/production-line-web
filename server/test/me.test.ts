import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { login, request, setupOwner } from "./auth-helpers.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("/api/me", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("requires a session", async () => {
    expect((await request(t, "GET", "/api/me")).statusCode).toBe(401);
    expect((await request(t, "PATCH", "/api/me", { body: { color: "#000000" } })).statusCode).toBe(
      401,
    );
  });

  it("updates color and time format and emits user.updated for color", async () => {
    const owner = await setupOwner(t);
    const events: string[] = [];
    t.ctx.events.onAny((name) => events.push(name));

    const res = await request(t, "PATCH", "/api/me", {
      cookie: owner.cookie,
      body: { color: "#FF0000", time_format: "24h" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ color: "#ff0000", time_format: "24h" });
    expect(events).toEqual(["user.updated"]);
  });

  it("rejects invalid preference values", async () => {
    const owner = await setupOwner(t);
    const res = await request(t, "PATCH", "/api/me", {
      cookie: owner.cookie,
      body: { time_format: "25h" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("changes the password with the current one and revokes every other session", async () => {
    const owner = await setupOwner(t, "owner", "ownerpass1");
    const phone = await login(t, "owner", "ownerpass1");

    const wrong = await request(t, "PATCH", "/api/me", {
      cookie: owner.cookie,
      body: { password: "newpassword2", current_password: "incorrect!" },
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe("wrong_password");

    const missing = await request(t, "PATCH", "/api/me", {
      cookie: owner.cookie,
      body: { password: "newpassword2" },
    });
    expect(missing.statusCode).toBe(400);

    const ok = await request(t, "PATCH", "/api/me", {
      cookie: owner.cookie,
      body: { password: "newpassword2", current_password: "ownerpass1" },
    });
    expect(ok.statusCode).toBe(200);

    expect((await request(t, "GET", "/api/me", { cookie: owner.cookie })).statusCode).toBe(200);
    expect((await request(t, "GET", "/api/me", { cookie: phone.cookie })).statusCode).toBe(401);
    expect(
      (
        await request(t, "POST", "/api/auth/login", {
          body: { username: "owner", password: "ownerpass1" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await request(t, "POST", "/api/auth/login", {
          body: { username: "owner", password: "newpassword2" },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("avatar routes exist but are disabled until image support lands", async () => {
    const owner = await setupOwner(t);
    const put = await request(t, "PUT", "/api/me/avatar", { cookie: owner.cookie, body: {} });
    expect(put.statusCode).toBe(403);
    expect(put.json().error).toBe("images_disabled");
    const del = await request(t, "DELETE", "/api/me/avatar", { cookie: owner.cookie });
    expect(del.statusCode).toBe(403);
  });
});
