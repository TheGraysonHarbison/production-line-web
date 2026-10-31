import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { login, ORIGIN, seedRoles } from "./auth-helpers.js";
import { createLiveApp, expectEvent, type LiveApp, openStream } from "./stream-helpers.js";

/** fetch against the live server with the CSRF Origin and a session cookie. */
async function call(live: LiveApp, method: string, path: string, cookie: string, body?: unknown) {
  const headers: Record<string, string> = {
    cookie,
    origin: ORIGIN.replace("localhost:80", new URL(live.baseUrl).host),
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${live.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: res.status === 204 ? null : await res.json() };
}

describe("GET /api/stream", () => {
  let live: LiveApp;
  let roles: Awaited<ReturnType<typeof seedRoles>>;
  beforeEach(async () => {
    live = await createLiveApp();
    roles = await seedRoles(live);
  });
  afterEach(async () => {
    await live.cleanup();
  });

  it("requires a session", async () => {
    const s = await openStream(live);
    expect(s.status).toBe(401);
  });

  it("opens with SSE headers, a retry hint, and heartbeats", async () => {
    const s = await openStream(live, roles.user.cookie);
    expect(s.status).toBe(200);
    const hello = await s.next();
    expect(hello.comment).toBe("connected");
    const ping = await s.next(1000);
    expect(ping.comment).toBe("ping");
    expect(live.ctx.broadcaster.size).toBe(1);
    s.close();
    await s.closed;
    await new Promise((r) => setTimeout(r, 50));
    expect(live.ctx.broadcaster.size).toBe(0);
  });

  it("delivers every event type with the expected payload, to every client", async () => {
    const a = await openStream(live, roles.user.cookie);
    const b = await openStream(live, roles.admin.cookie);
    await a.next();
    await b.next();

    const printer = await call(live, "POST", "/api/printers", roles.admin.cookie, {
      name: "Prusa",
    });
    expect(printer.status).toBe(201);
    const start = new Date(Math.ceil((Date.now() + 3_600_000) / 300_000) * 300_000).toISOString();
    const end = new Date(Date.parse(start) + 3_600_000).toISOString();
    const slot = await call(live, "POST", "/api/slots", roles.user.cookie, {
      name: "Benchy",
      start_at: start,
      end_at: end,
      printer_ids: [printer.json.id],
    });
    expect(slot.status).toBe(201);
    await call(live, "PATCH", `/api/slots/${slot.json.id}`, roles.user.cookie, {
      name: "Benchy 2",
    });
    await call(live, "PATCH", `/api/printers/${printer.json.id}`, roles.admin.cookie, {
      invisible: true,
    });
    await call(live, "PATCH", "/api/settings", roles.admin.cookie, {
      ha_token: "very-secret",
      timezone: "Europe/Oslo",
    });
    await call(live, "PATCH", "/api/me", roles.user.cookie, { color: "#ff0000" });
    await call(live, "DELETE", `/api/slots/${slot.json.id}`, roles.user.cookie);
    await call(live, "DELETE", `/api/printers/${printer.json.id}`, roles.admin.cookie);

    const events = await a.take(8);
    expect(events.map((e) => e.event)).toEqual([
      "printer.created",
      "slot.created",
      "slot.updated",
      "printer.updated",
      "settings.updated",
      "user.updated",
      "slot.deleted",
      "printer.deleted",
    ]);
    expect(expectEvent(events[0] as never, "printer.created")).toMatchObject({
      printer: { name: "Prusa", invisible: false },
    });
    expect(expectEvent(events[1] as never, "slot.created")).toMatchObject({
      slot: {
        name: "Benchy",
        user: { username: "user" },
        printers: [{ name: "Prusa" }],
        images: [],
      },
    });
    expect(expectEvent(events[2] as never, "slot.updated")).toMatchObject({
      slot: { name: "Benchy 2" },
    });
    expect(expectEvent(events[4] as never, "settings.updated")).toEqual({
      keys: ["ha_token", "timezone"],
    });
    expect(events[4]?.data).not.toContain("very-secret");
    const user = expectEvent(events[5] as never, "user.updated") as {
      user: Record<string, unknown>;
    };
    expect(Object.keys(user.user).sort()).toEqual([
      "avatar_url",
      "color",
      "id",
      "role",
      "username",
    ]);
    expect(user.user.color).toBe("#ff0000");
    // ids are increasing
    expect(Number(events[7]?.id)).toBeGreaterThan(Number(events[0]?.id));

    const other = await b.take(8);
    expect(other.map((e) => e.event)).toEqual(events.map((e) => e.event));
    a.close();
    b.close();
  });

  it("closes the stream when its session is revoked by logout", async () => {
    const s = await openStream(live, roles.user.cookie);
    await s.next();
    await call(live, "POST", "/api/auth/logout", roles.user.cookie);
    await s.closed;
    expect(live.ctx.broadcaster.size).toBe(0);
    expect((await openStream(live, roles.user.cookie)).status).toBe(401);
  });

  it("closes other sessions' streams on password change but keeps the caller's", async () => {
    const phone = await login(live, "user", "userpass1");
    const laptop = await openStream(live, roles.user.cookie);
    const phoneStream = await openStream(live, phone.cookie);
    await laptop.next();
    await phoneStream.next();

    const res = await call(live, "PATCH", "/api/me", roles.user.cookie, {
      password: "newpassword2",
      current_password: "userpass1",
    });
    expect(res.status).toBe(200);
    await phoneStream.closed;
    // The laptop stream is still alive and receiving.
    await call(live, "POST", "/api/printers", roles.admin.cookie, { name: "Still here" });
    const [ev] = await laptop.take(1);
    expect(ev?.event).toBe("printer.created");
    laptop.close();
  });

  it("closes a deleted user's streams and tells everyone else", async () => {
    const victim = await openStream(live, roles.user.cookie);
    const watcher = await openStream(live, roles.admin.cookie);
    await victim.next();
    await watcher.next();
    const res = await call(live, "DELETE", `/api/users/${roles.user.me.id}`, roles.owner.cookie);
    expect(res.status).toBe(204);
    await victim.closed;
    const [ev] = await watcher.take(1);
    expect(expectEvent(ev as never, "user.deleted")).toMatchObject({ user: { username: "user" } });
    watcher.close();
  });

  it("server shutdown ends open streams promptly", async () => {
    const s = await openStream(live, roles.user.cookie);
    await s.next();
    const started = Date.now();
    await live.app.close();
    await s.closed;
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
