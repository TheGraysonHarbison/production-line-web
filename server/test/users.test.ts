import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { login, request, seedRoles } from "./auth-helpers.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("/api/users", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("lists public fields only, to any signed-in user", async () => {
    const { user } = await seedRoles(t);
    const res = await request(t, "GET", "/api/users", { cookie: user.cookie });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Record<string, unknown>[];
    expect(list.map((u) => u.username)).toEqual(["admin", "owner", "user"]);
    for (const u of list) {
      expect(Object.keys(u).sort()).toEqual(["avatar_url", "color", "id", "role", "username"]);
    }
    expect((await request(t, "GET", "/api/users")).statusCode).toBe(401);
  });

  describe("role matrix", () => {
    it("only the Owner may change roles, delete users, or transfer ownership", async () => {
      const { owner, admin, user } = await seedRoles(t);
      const targets = [
        ["PATCH", `/api/users/${user.me.id}/role`, { role: "admin" }],
        ["DELETE", `/api/users/${user.me.id}`, undefined],
        ["POST", `/api/users/${user.me.id}/transfer-ownership`, { current_password: "userpass1" }],
      ] as const;
      for (const [method, url, body] of targets) {
        for (const who of [admin, user]) {
          const res = await request(t, method, url, { cookie: who.cookie, body });
          expect(res.statusCode, `${who.me.username} ${method} ${url}`).toBe(403);
          expect(res.json().error).toBe("insufficient_role");
        }
        const anon = await request(t, method, url, { body });
        expect(anon.statusCode, `anon ${method} ${url}`).toBe(401);
      }
      expect(owner.me.role).toBe("owner");
    });
  });

  it("owner grants and revokes admin, emitting user.updated", async () => {
    const { owner, user } = await seedRoles(t);
    const names: string[] = [];
    t.ctx.events.on("user.updated", (p) => names.push(`${p.user.username}:${p.user.role}`));

    const up = await request(t, "PATCH", `/api/users/${user.me.id}/role`, {
      cookie: owner.cookie,
      body: { role: "admin" },
    });
    expect(up.statusCode).toBe(200);
    expect(up.json().role).toBe("admin");
    const down = await request(t, "PATCH", `/api/users/${user.me.id}/role`, {
      cookie: owner.cookie,
      body: { role: "user" },
    });
    expect(down.json().role).toBe("user");
    expect(names).toEqual(["user:admin", "user:user"]);

    const bad = await request(t, "PATCH", `/api/users/${user.me.id}/role`, {
      cookie: owner.cookie,
      body: { role: "owner" },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await request(t, "PATCH", "/api/users/999/role", {
      cookie: owner.cookie,
      body: { role: "admin" },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("the Owner cannot be demoted or deleted", async () => {
    const { owner } = await seedRoles(t);
    const demote = await request(t, "PATCH", `/api/users/${owner.me.id}/role`, {
      cookie: owner.cookie,
      body: { role: "user" },
    });
    expect(demote.statusCode).toBe(403);
    expect(demote.json().error).toBe("owner_immutable");
    const del = await request(t, "DELETE", `/api/users/${owner.me.id}`, { cookie: owner.cookie });
    expect(del.statusCode).toBe(403);
    expect(del.json().error).toBe("owner_immutable");
  });

  it("transfers ownership with password confirmation; previous Owner becomes Admin", async () => {
    const { owner, user } = await seedRoles(t);
    const wrong = await request(t, "POST", `/api/users/${user.me.id}/transfer-ownership`, {
      cookie: owner.cookie,
      body: { current_password: "nope" },
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe("wrong_password");

    const self = await request(t, "POST", `/api/users/${owner.me.id}/transfer-ownership`, {
      cookie: owner.cookie,
      body: { current_password: "ownerpass1" },
    });
    expect(self.statusCode).toBe(400);

    const ok = await request(t, "POST", `/api/users/${user.me.id}/transfer-ownership`, {
      cookie: owner.cookie,
      body: { current_password: "ownerpass1" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().role).toBe("owner");

    expect((await request(t, "GET", "/api/me", { cookie: owner.cookie })).json().role).toBe(
      "admin",
    );
    expect((await request(t, "GET", "/api/me", { cookie: user.cookie })).json().role).toBe("owner");
    // Old owner is now an admin and may no longer manage roles.
    const denied = await request(t, "PATCH", `/api/users/${user.me.id}/role`, {
      cookie: owner.cookie,
      body: { role: "user" },
    });
    expect(denied.statusCode).toBe(403);
    const owners = t.ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").get();
    expect(owners).toEqual({ n: 1 });
  });

  it("deletes a user, cascading sessions and emitting user.deleted", async () => {
    const { owner, user } = await seedRoles(t);
    await login(t, "user", "userpass1");
    const deleted: number[] = [];
    t.ctx.events.on("user.deleted", (p) => deleted.push(p.user.id));

    const res = await request(t, "DELETE", `/api/users/${user.me.id}`, { cookie: owner.cookie });
    expect(res.statusCode).toBe(204);
    expect(deleted).toEqual([user.me.id]);
    expect((await request(t, "GET", "/api/me", { cookie: user.cookie })).statusCode).toBe(401);
    expect(
      t.ctx.db
        .prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = :id")
        .get({ id: user.me.id }),
    ).toEqual({ n: 0 });
    expect(
      (await request(t, "DELETE", `/api/users/${user.me.id}`, { cookie: owner.cookie })).statusCode,
    ).toBe(404);
  });
});
