import { ConflictResponseSchema, roundToFiveMinutes, SlotSchema } from "@production-line/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { request, seedRoles } from "./auth-helpers.js";
import { createTestApp, type TestApp } from "./helpers.js";

type Roles = Awaited<ReturnType<typeof seedRoles>>;

/** ISO instant `minutes` from now, snapped to the 5-minute grid (ceil so it's never in the past). */
const at = (minutes: number) =>
  roundToFiveMinutes(new Date(Date.now() + minutes * 60_000).toISOString(), "ceil");

async function addPrinter(
  t: TestApp,
  roles: Roles,
  name: string,
  invisible = false,
): Promise<number> {
  const res = await request(t, "POST", "/api/printers", {
    cookie: roles.admin.cookie,
    body: { name, invisible },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
}

function slotBody(
  printer_ids: number[],
  startMin: number,
  endMin: number,
  extra: Record<string, unknown> = {},
) {
  return { name: "Benchy", start_at: at(startMin), end_at: at(endMin), printer_ids, ...extra };
}

describe("/api/slots", () => {
  let t: TestApp;
  let roles: Roles;
  let p1: number;
  let p2: number;
  beforeEach(async () => {
    t = await createTestApp();
    roles = await seedRoles(t);
    p1 = await addPrinter(t, roles, "Prusa");
    p2 = await addPrinter(t, roles, "Bambu");
  });
  afterEach(async () => {
    await t.cleanup();
  });

  describe("create", () => {
    it("creates a slot with embedded user and printers, rounded to 5 minutes, and emits slot.created", async () => {
      const events: string[] = [];
      t.ctx.events.onAny((n) => events.push(n));
      const rawStart = new Date(Date.now() + 60 * 60_000 + 97_000).toISOString(); // +1h01m37s → rounds
      const res = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: {
          name: " Benchy ",
          description: "PLA",
          start_at: rawStart,
          end_at: at(120),
          printer_ids: [p1, p2, p1],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      const slot = SlotSchema.parse(res.json());
      expect(slot.name).toBe("Benchy");
      expect(slot.description).toBe("PLA");
      expect(slot.start_at).toBe(roundToFiveMinutes(rawStart));
      expect(slot.user).toMatchObject({ id: roles.user.me.id, username: "user" });
      expect(slot.printers.map((p) => p.name)).toEqual(["Bambu", "Prusa"]);
      expect(slot.images).toEqual([]);
      expect(events).toEqual(["slot.created"]);
    });

    it("requires a session and validates the body", async () => {
      expect(
        (await request(t, "POST", "/api/slots", { body: slotBody([p1], 10, 20) })).statusCode,
      ).toBe(401);
      for (const body of [
        { ...slotBody([p1], 10, 20), name: "" },
        { ...slotBody([p1], 10, 20), name: "x".repeat(81) },
        { ...slotBody([p1], 10, 20), description: "x".repeat(2001) },
        { ...slotBody([], 10, 20) },
        { ...slotBody([p1], 10, 20), start_at: "tomorrow" },
      ]) {
        const res = await request(t, "POST", "/api/slots", { cookie: roles.user.cookie, body });
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
        expect(res.json().error).toBe("validation");
      }
    });

    it("enforces the time rules: past, order, minimum length, 30-day horizon", async () => {
      const cases: [Record<string, unknown>, string][] = [
        [slotBody([p1], -30, 30), "slot_in_past"],
        [slotBody([p1], 30, 30), "slot_end_before_start"],
        [slotBody([p1], 30, 20), "slot_end_before_start"],
        [
          {
            ...slotBody([p1], 30, 30),
            end_at: new Date(Date.parse(at(30)) + 60_000).toISOString(),
          },
          "slot_end_before_start",
        ],
        [slotBody([p1], 30, 60 * 24 * 31), "slot_beyond_horizon"],
      ];
      for (const [body, code] of cases) {
        const res = await request(t, "POST", "/api/slots", { cookie: roles.user.cookie, body });
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
        expect(res.json().error, JSON.stringify(body)).toBe(code);
      }
      // "Start now" rounds to the nearest mark and is accepted even when that mark just passed,
      // and so is the current mark itself (floor), which makes the slot running immediately.
      const now = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: { ...slotBody([p1], 0, 30), start_at: new Date().toISOString() },
      });
      expect(now.statusCode, now.body).toBe(201);
      const floorNow = roundToFiveMinutes(new Date().toISOString(), "floor");
      const running = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: { ...slotBody([p2], 0, 30), start_at: floorNow, end_at: at(30) },
      });
      expect(running.statusCode, running.body).toBe(201);
      expect(running.json().start_at).toBe(floorNow);
      const earlier = new Date(Date.parse(floorNow) - 5 * 60_000).toISOString();
      const past = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: { ...slotBody([p2], 0, 30), start_at: earlier, end_at: at(40) },
      });
      expect(past.json().error).toBe("slot_in_past");
    });

    it("rejects unknown and invisible printers", async () => {
      const ghost = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: slotBody([999], 10, 20),
      });
      expect(ghost.statusCode).toBe(400);
      expect(ghost.json().error).toBe("printer_not_found");
      const hidden = await addPrinter(t, roles, "Hidden", true);
      const res = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: slotBody([p1, hidden], 10, 20),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "printer_invisible", printer_id: hidden });
    });

    it("returns 409 with the blocking slot when a printer is taken, and only for the taken printers", async () => {
      const first = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: slotBody([p1], 60, 120),
      });
      expect(first.statusCode).toBe(201);

      const res = await request(t, "POST", "/api/slots", {
        cookie: roles.admin.cookie,
        body: slotBody([p1, p2], 90, 150),
      });
      expect(res.statusCode).toBe(409);
      const conflict = ConflictResponseSchema.parse(res.json());
      expect(conflict.printers).toHaveLength(1);
      expect(conflict.printers[0]).toMatchObject({
        id: p1,
        name: "Prusa",
        slot: { id: first.json().id, name: "Benchy", user: { username: "user" } },
      });
      expect(conflict.message).toMatch(/already booked/);
      // Nothing was written.
      const list = await request(t, "GET", `/api/slots?from=${at(0)}&to=${at(600)}`, {
        cookie: roles.user.cookie,
      });
      expect(list.json()).toHaveLength(1);

      // Touching edges are fine; a different printer at the same time is fine.
      expect(
        (
          await request(t, "POST", "/api/slots", {
            cookie: roles.admin.cookie,
            body: slotBody([p1], 120, 180),
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await request(t, "POST", "/api/slots", {
            cookie: roles.admin.cookie,
            body: slotBody([p1], 30, 60),
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await request(t, "POST", "/api/slots", {
            cookie: roles.admin.cookie,
            body: slotBody([p2], 60, 120),
          })
        ).statusCode,
      ).toBe(201);
    });

    it("serialises simultaneous bookings so exactly one wins", async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          request(t, "POST", "/api/slots", {
            cookie: i % 2 ? roles.user.cookie : roles.admin.cookie,
            body: slotBody([p1], 60, 120),
          }),
        ),
      );
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes).toEqual([201, 409, 409, 409, 409]);
      expect(t.ctx.db.prepare("SELECT COUNT(*) AS n FROM slot_printers").get()).toEqual({ n: 1 });
    });
  });

  describe("read", () => {
    it("lists slots overlapping the range, capped at 62 days, and fetches by id", async () => {
      const a = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: slotBody([p1], 60, 120),
      });
      await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: slotBody([p2], 60 * 24 * 5, 60 * 24 * 5 + 60),
      });

      const day = await request(t, "GET", `/api/slots?from=${at(0)}&to=${at(60 * 24)}`, {
        cookie: roles.admin.cookie,
      });
      expect(day.statusCode).toBe(200);
      expect(day.json().map((s: { id: number }) => s.id)).toEqual([a.json().id]);
      // Partial overlap at the edge counts; touching does not.
      expect(
        (
          await request(t, "GET", `/api/slots?from=${at(110)}&to=${at(130)}`, {
            cookie: roles.admin.cookie,
          })
        ).json(),
      ).toHaveLength(1);
      expect(
        (
          await request(t, "GET", `/api/slots?from=${at(120)}&to=${at(130)}`, {
            cookie: roles.admin.cookie,
          })
        ).json(),
      ).toHaveLength(0);

      const week = await request(t, "GET", `/api/slots?from=${at(0)}&to=${at(60 * 24 * 7)}`, {
        cookie: roles.admin.cookie,
      });
      expect(week.json()).toHaveLength(2);
      const tooLong = await request(t, "GET", `/api/slots?from=${at(0)}&to=${at(60 * 24 * 63)}`, {
        cookie: roles.admin.cookie,
      });
      expect(tooLong.statusCode).toBe(400);
      expect(
        (await request(t, "GET", "/api/slots", { cookie: roles.admin.cookie })).statusCode,
      ).toBe(400);

      const one = await request(t, "GET", `/api/slots/${a.json().id}`, {
        cookie: roles.admin.cookie,
      });
      expect(one.statusCode).toBe(200);
      expect(one.json().id).toBe(a.json().id);
      expect(
        (await request(t, "GET", "/api/slots/999", { cookie: roles.admin.cookie })).statusCode,
      ).toBe(404);
      expect((await request(t, "GET", `/api/slots/${a.json().id}`)).statusCode).toBe(401);
    });
  });

  describe("permissions", () => {
    it("the slot's user, admins, and the owner may edit/delete; others get 403", async () => {
      const mine = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: slotBody([p1], 60, 120),
      });
      const id = mine.json().id;
      const other = await request(t, "POST", "/api/auth/register", {
        body: { username: "other", password: "userpass1", favorite_color: "#000000" },
      });
      const otherCookie = `plw_session=${other.cookies.find((c) => c.name === "plw_session")?.value}`;

      const denied = await request(t, "PATCH", `/api/slots/${id}`, {
        cookie: otherCookie,
        body: { name: "Hijack" },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error).toBe("not_slot_owner");
      expect(
        (await request(t, "DELETE", `/api/slots/${id}`, { cookie: otherCookie })).statusCode,
      ).toBe(403);
      expect(
        (await request(t, "PATCH", `/api/slots/${id}`, { body: { name: "x" } })).statusCode,
      ).toBe(401);

      expect(
        (
          await request(t, "PATCH", `/api/slots/${id}`, {
            cookie: roles.user.cookie,
            body: { name: "Mine" },
          })
        ).json().name,
      ).toBe("Mine");
      expect(
        (
          await request(t, "PATCH", `/api/slots/${id}`, {
            cookie: roles.admin.cookie,
            body: { name: "Admin" },
          })
        ).json().name,
      ).toBe("Admin");
      expect(
        (
          await request(t, "PATCH", `/api/slots/${id}`, {
            cookie: roles.owner.cookie,
            body: { name: "Owner" },
          })
        ).json().name,
      ).toBe("Owner");
      expect(
        (await request(t, "DELETE", `/api/slots/${id}`, { cookie: roles.admin.cookie })).statusCode,
      ).toBe(204);
      expect(
        (
          await request(t, "PATCH", "/api/slots/999", {
            cookie: roles.admin.cookie,
            body: { name: "x" },
          })
        ).statusCode,
      ).toBe(404);
    });
  });

  describe("update", () => {
    it("re-runs the conflict check excluding itself and swaps printers", async () => {
      const a = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: slotBody([p1], 60, 120),
      });
      const id = a.json().id;
      const events: string[] = [];
      t.ctx.events.onAny((n) => events.push(n));

      // Same window, same printer: no self-conflict.
      const same = await request(t, "PATCH", `/api/slots/${id}`, {
        cookie: roles.user.cookie,
        body: { start_at: at(60), end_at: at(120) },
      });
      expect(same.statusCode, same.body).toBe(200);
      // Move to p2 and shift: fine.
      const moved = await request(t, "PATCH", `/api/slots/${id}`, {
        cookie: roles.user.cookie,
        body: { printer_ids: [p2], start_at: at(90), end_at: at(150) },
      });
      expect(moved.statusCode).toBe(200);
      expect(moved.json().printers.map((p: { id: number }) => p.id)).toEqual([p2]);
      expect(moved.json().start_at).toBe(at(90));
      expect(moved.json().updated_at > moved.json().created_at).toBe(true);
      expect(events).toEqual(["slot.updated", "slot.updated"]);

      // Someone books p1 60–120; moving back onto p1 conflicts.
      await request(t, "POST", "/api/slots", {
        cookie: roles.admin.cookie,
        body: slotBody([p1], 60, 120),
      });
      const back = await request(t, "PATCH", `/api/slots/${id}`, {
        cookie: roles.user.cookie,
        body: { printer_ids: [p1, p2] },
      });
      expect(back.statusCode).toBe(409);
      expect(back.json().printers.map((p: { id: number }) => p.id)).toEqual([p1]);
      // Rejected updates leave the slot untouched.
      expect(
        (await request(t, "GET", `/api/slots/${id}`, { cookie: roles.user.cookie }))
          .json()
          .printers.map((p: { id: number }) => p.id),
      ).toEqual([p2]);
      expect(
        (await request(t, "PATCH", `/api/slots/${id}`, { cookie: roles.user.cookie, body: {} }))
          .statusCode,
      ).toBe(400);
    });

    it("extending is allowed up to the next slot on each printer and blocked beyond it", async () => {
      const a = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: slotBody([p1, p2], 60, 120),
      });
      const id = a.json().id;
      await request(t, "POST", "/api/slots", {
        cookie: roles.admin.cookie,
        body: { ...slotBody([p1], 180, 240), name: "Next on Prusa" },
      });
      await request(t, "POST", "/api/slots", {
        cookie: roles.admin.cookie,
        body: { ...slotBody([p2], 150, 200), name: "Next on Bambu" },
      });

      const ok = await request(t, "PATCH", `/api/slots/${id}`, {
        cookie: roles.user.cookie,
        body: { end_at: at(150) },
      });
      expect(ok.statusCode, ok.body).toBe(200);
      const blocked = await request(t, "PATCH", `/api/slots/${id}`, {
        cookie: roles.user.cookie,
        body: { end_at: at(155) },
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().message).toMatch(
        /cannot extend: blocked by Bambu \(Next on Bambu by admin\)/,
      );
      expect(blocked.json().printers.map((p: { name: string }) => p.name)).toEqual(["Bambu"]);
    });

    it("a running slot can be extended but its start cannot move; a hidden printer already on it stays", async () => {
      const hidden = await addPrinter(t, roles, "Soon hidden");
      const created = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: slotBody([p1, hidden], 0, 60),
      });
      const id = created.json().id;
      // Make it running: pull start_at into the past directly.
      const start = new Date(Date.now() - 10 * 60_000).toISOString();
      t.ctx.db
        .prepare("UPDATE slots SET start_at = :s WHERE id = :id")
        .run({ s: roundToFiveMinutes(start, "floor"), id });
      await request(t, "PATCH", `/api/printers/${hidden}`, {
        cookie: roles.admin.cookie,
        body: { invisible: true },
      });

      const move = await request(t, "PATCH", `/api/slots/${id}`, {
        cookie: roles.user.cookie,
        body: { start_at: at(5) },
      });
      expect(move.statusCode).toBe(400);
      expect(move.json().error).toBe("slot_running_start_locked");

      const extend = await request(t, "PATCH", `/api/slots/${id}`, {
        cookie: roles.user.cookie,
        body: { end_at: at(90), name: "Still going" },
      });
      expect(extend.statusCode, extend.body).toBe(200);
      expect(
        extend
          .json()
          .printers.map((p: { id: number }) => p.id)
          .sort(),
      ).toEqual([p1, hidden].sort());

      // Adding the hidden printer to another slot is refused, but keeping it on this one is fine.
      expect(
        (
          await request(t, "PATCH", `/api/slots/${id}`, {
            cookie: roles.user.cookie,
            body: { printer_ids: [p1, hidden, p2] },
          })
        ).statusCode,
      ).toBe(200);
      const other = await request(t, "POST", "/api/slots", {
        cookie: roles.admin.cookie,
        body: slotBody([hidden], 120, 150),
      });
      expect(other.statusCode).toBe(400);
      expect(other.json().error).toBe("printer_invisible");

      // A future slot's start can move as long as it isn't into the past.
      const future = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: slotBody([p2], 200, 230),
      });
      expect(
        (
          await request(t, "PATCH", `/api/slots/${future.json().id}`, {
            cookie: roles.user.cookie,
            body: { start_at: at(-30) },
          })
        ).json().error,
      ).toBe("slot_in_past");
      expect(
        (
          await request(t, "PATCH", `/api/slots/${future.json().id}`, {
            cookie: roles.user.cookie,
            body: { start_at: at(210) },
          })
        ).statusCode,
      ).toBe(200);
    });
  });

  describe("delete and cascades", () => {
    it("deletes a slot and emits slot.deleted; printers then become deletable", async () => {
      const a = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: slotBody([p1], 60, 120),
      });
      const id = a.json().id;
      const inUse = await request(t, "DELETE", `/api/printers/${p1}`, {
        cookie: roles.admin.cookie,
      });
      expect(inUse.statusCode).toBe(409);
      expect(inUse.json()).toMatchObject({
        error: "printer_in_use",
        slots: [{ id, name: "Benchy" }],
      });

      const deleted: number[] = [];
      t.ctx.events.on("slot.deleted", (p) => deleted.push(p.slot.id));
      expect(
        (await request(t, "DELETE", `/api/slots/${id}`, { cookie: roles.user.cookie })).statusCode,
      ).toBe(204);
      expect(deleted).toEqual([id]);
      expect(
        (await request(t, "GET", `/api/slots/${id}`, { cookie: roles.user.cookie })).statusCode,
      ).toBe(404);
      expect(t.ctx.db.prepare("SELECT COUNT(*) AS n FROM slot_printers").get()).toEqual({ n: 0 });
      expect(
        (await request(t, "DELETE", `/api/printers/${p1}`, { cookie: roles.admin.cookie }))
          .statusCode,
      ).toBe(204);
    });

    it("deleting a user emits slot.deleted for each of their slots, then user.deleted", async () => {
      const s1 = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: slotBody([p1], 60, 120),
      });
      const s2 = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: slotBody([p2], 200, 260),
      });
      await request(t, "POST", "/api/slots", {
        cookie: roles.admin.cookie,
        body: slotBody([p1], 300, 360),
      });
      const seen: string[] = [];
      t.ctx.events.onAny((name, payload) => {
        const p = payload as { slot?: { id: number }; user?: { username: string } };
        seen.push(p.slot ? `${name}:${p.slot.id}` : `${name}:${p.user?.username}`);
      });

      const res = await request(t, "DELETE", `/api/users/${roles.user.me.id}`, {
        cookie: roles.owner.cookie,
      });
      expect(res.statusCode).toBe(204);
      expect(seen).toEqual([
        `slot.deleted:${s1.json().id}`,
        `slot.deleted:${s2.json().id}`,
        "user.deleted:user",
      ]);
      const remaining = await request(t, "GET", `/api/slots?from=${at(0)}&to=${at(600)}`, {
        cookie: roles.admin.cookie,
      });
      expect(remaining.json().map((s: { user: { username: string } }) => s.user.username)).toEqual([
        "admin",
      ]);
      expect(t.ctx.db.prepare("SELECT COUNT(*) AS n FROM slot_printers").get()).toEqual({ n: 1 });
    });
  });
});
