import { PrinterSchema } from "@production-line/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { request, seedRoles } from "./auth-helpers.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("/api/printers", () => {
  let t: TestApp;
  let roles: Awaited<ReturnType<typeof seedRoles>>;
  beforeEach(async () => {
    t = await createTestApp();
    roles = await seedRoles(t);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("admins and the owner create printers; users may only list", async () => {
    const asUser = await request(t, "POST", "/api/printers", {
      cookie: roles.user.cookie,
      body: { name: "Nope" },
    });
    expect(asUser.statusCode).toBe(403);
    expect((await request(t, "POST", "/api/printers", { body: { name: "Anon" } })).statusCode).toBe(
      401,
    );

    const created = await request(t, "POST", "/api/printers", {
      cookie: roles.admin.cookie,
      body: { name: " Prusa MK4 " },
    });
    expect(created.statusCode).toBe(201);
    const printer = PrinterSchema.parse(created.json());
    expect(printer).toMatchObject({ name: "Prusa MK4", invisible: false });

    const byOwner = await request(t, "POST", "/api/printers", {
      cookie: roles.owner.cookie,
      body: { name: "Bambu P1S", invisible: true },
    });
    expect(byOwner.statusCode).toBe(201);
    expect(byOwner.json().invisible).toBe(true);

    const list = await request(t, "GET", "/api/printers", { cookie: roles.user.cookie });
    expect(list.statusCode).toBe(200);
    expect(
      list.json().map((p: { name: string; invisible: boolean }) => [p.name, p.invisible]),
    ).toEqual([
      ["Bambu P1S", true],
      ["Prusa MK4", false],
    ]);
    expect((await request(t, "GET", "/api/printers")).statusCode).toBe(401);
  });

  it("names are unique case-insensitively, on create and rename", async () => {
    await request(t, "POST", "/api/printers", {
      cookie: roles.admin.cookie,
      body: { name: "Voron" },
    });
    const dup = await request(t, "POST", "/api/printers", {
      cookie: roles.admin.cookie,
      body: { name: "voron" },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe("printer_name_taken");

    const other = await request(t, "POST", "/api/printers", {
      cookie: roles.admin.cookie,
      body: { name: "Ender" },
    });
    const rename = await request(t, "PATCH", `/api/printers/${other.json().id}`, {
      cookie: roles.admin.cookie,
      body: { name: "VORON" },
    });
    expect(rename.statusCode).toBe(409);
  });

  it("validates bodies", async () => {
    expect(
      (
        await request(t, "POST", "/api/printers", {
          cookie: roles.admin.cookie,
          body: { name: "" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(t, "POST", "/api/printers", {
          cookie: roles.admin.cookie,
          body: { name: "x".repeat(65) },
        })
      ).statusCode,
    ).toBe(400);
    const p = await request(t, "POST", "/api/printers", {
      cookie: roles.admin.cookie,
      body: { name: "P" },
    });
    expect(
      (
        await request(t, "PATCH", `/api/printers/${p.json().id}`, {
          cookie: roles.admin.cookie,
          body: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(t, "PATCH", "/api/printers/abc", {
          cookie: roles.admin.cookie,
          body: { name: "x" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(t, "PATCH", "/api/printers/999", {
          cookie: roles.admin.cookie,
          body: { name: "x" },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("invisible round-trips and every change emits a printer event", async () => {
    const events: string[] = [];
    t.ctx.events.onAny((name, payload) =>
      events.push(`${name}:${(payload as { printer: { name: string } }).printer.name}`),
    );

    const created = await request(t, "POST", "/api/printers", {
      cookie: roles.admin.cookie,
      body: { name: "MK4" },
    });
    const id = created.json().id;
    const hide = await request(t, "PATCH", `/api/printers/${id}`, {
      cookie: roles.admin.cookie,
      body: { invisible: true },
    });
    expect(hide.json().invisible).toBe(true);
    expect(
      (await request(t, "GET", "/api/printers", { cookie: roles.user.cookie })).json()[0].invisible,
    ).toBe(true);
    const show = await request(t, "PATCH", `/api/printers/${id}`, {
      cookie: roles.admin.cookie,
      body: { invisible: false, name: "MK4S" },
    });
    expect(show.json()).toMatchObject({ invisible: false, name: "MK4S" });

    const del = await request(t, "DELETE", `/api/printers/${id}`, { cookie: roles.admin.cookie });
    expect(del.statusCode).toBe(204);
    expect(
      (await request(t, "GET", "/api/printers", { cookie: roles.user.cookie })).json(),
    ).toEqual([]);
    expect(
      (await request(t, "DELETE", `/api/printers/${id}`, { cookie: roles.admin.cookie }))
        .statusCode,
    ).toBe(404);
    expect(events).toEqual([
      "printer.created:MK4",
      "printer.updated:MK4",
      "printer.updated:MK4S",
      "printer.deleted:MK4S",
    ]);
  });

  it("refuses to delete a printer that is part of a slot", async () => {
    const created = await request(t, "POST", "/api/printers", {
      cookie: roles.admin.cookie,
      body: { name: "Busy" },
    });
    const id = created.json().id;
    t.ctx.db
      .prepare(
        `INSERT INTO slots (id, user_id, name, start_at, end_at, created_at, updated_at)
         VALUES (7, :uid, 'Benchy', '2030-01-01T10:00:00.000Z', '2030-01-01T11:00:00.000Z', 'x', 'x')`,
      )
      .run({ uid: roles.user.me.id });
    t.ctx.db
      .prepare("INSERT INTO slot_printers (slot_id, printer_id) VALUES (7, :pid)")
      .run({ pid: id });

    const del = await request(t, "DELETE", `/api/printers/${id}`, { cookie: roles.admin.cookie });
    expect(del.statusCode).toBe(409);
    expect(del.json()).toMatchObject({
      error: "printer_in_use",
      slots: [{ id: 7, name: "Benchy" }],
    });
    expect(
      (await request(t, "GET", "/api/printers", { cookie: roles.user.cookie })).json(),
    ).toHaveLength(1);
  });
});
