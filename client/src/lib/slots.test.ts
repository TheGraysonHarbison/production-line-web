import type { Printer, Slot } from "@production-line/shared";
import { describe, expect, it } from "vitest";
import {
  canEditSlot,
  extensionCeiling,
  findConflicts,
  nextSlotStart,
  printerAvailability,
  upcomingSlots,
} from "./slots.ts";

const user = (id: number, role: "owner" | "admin" | "user" = "user") => ({
  id,
  username: `u${id}`,
  color: "#000000",
  role,
  avatar_url: null,
});
const printer = (id: number, invisible = false): Printer => ({
  id,
  name: `P${id}`,
  invisible,
  created_at: "x",
});
const slot = (id: number, uid: number, start: string, end: string, printers: number[]): Slot => ({
  id,
  user: user(uid),
  name: `S${id}`,
  description: null,
  start_at: start,
  end_at: end,
  created_at: "x",
  updated_at: "x",
  printers: printers.map((p) => printer(p)),
  images: [],
});
const T = (h: number, m = 0) =>
  `2026-11-02T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
const slots = [
  slot(1, 1, T(10), T(11), [1]),
  slot(2, 2, T(12), T(13), [1, 2]),
  slot(3, 2, T(9), T(10), [2]),
];

describe("slot helpers", () => {
  it("canEditSlot follows the §3.3 rule", () => {
    const me = { ...user(1), time_format: "12h" as const, created_at: "x" };
    expect(canEditSlot(me, slots[0] as Slot)).toBe(true);
    expect(canEditSlot(me, slots[1] as Slot)).toBe(false);
    expect(canEditSlot({ ...me, role: "admin" }, slots[1] as Slot)).toBe(true);
    expect(canEditSlot(null, slots[0] as Slot)).toBe(false);
  });

  it("findConflicts reports the blocking slot per printer and can exclude one slot", () => {
    const c = findConflicts(slots, [printer(1), printer(2)], {
      start_at: T(10, 30),
      end_at: T(12, 30),
    });
    expect([...c.keys()]).toEqual([1, 2]);
    expect(c.get(1)?.slot.id).toBe(1);
    expect(c.get(2)?.slot.id).toBe(2);
    const touching = findConflicts(slots, [printer(1)], { start_at: T(11), end_at: T(12) });
    expect(touching.size).toBe(0);
    const excluded = findConflicts(slots, [printer(1)], { start_at: T(10), end_at: T(11) }, 1);
    expect(excluded.size).toBe(0);
  });

  it("nextSlotStart / extensionCeiling find the earliest later slot on any shared printer", () => {
    expect(nextSlotStart(slots[0] as Slot, slots)).toBe(T(12));
    expect(nextSlotStart(slots[1] as Slot, slots)).toBeNull();
    expect(extensionCeiling(slots[0] as Slot, slots, Date.parse(T(10, 30)))).toBe(T(12));
    const ceiling = extensionCeiling(slots[1] as Slot, slots, Date.parse(T(12, 30)));
    expect(Date.parse(ceiling) - Date.parse(T(12, 30))).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("printerAvailability summarises the dock state", () => {
    expect(printerAvailability(printer(1), slots, Date.parse(T(10, 30)))).toMatchObject({
      state: "busy_until",
      at: T(11),
      by: { username: "u1" },
      slot: { id: 1, name: "S1" },
    });
    expect(printerAvailability(printer(1), slots, Date.parse(T(11, 30)))).toMatchObject({
      state: "free_until",
      at: T(12),
      by: { username: "u2" },
      slot: { id: 2, name: "S2" },
    });
    expect(printerAvailability(printer(1), slots, Date.parse(T(14)))).toEqual({ state: "free" });
    expect(printerAvailability(printer(3, true), slots)).toEqual({ state: "invisible" });
  });

  it("upcomingSlots lists only slots that have not started, soonest first, capped", () => {
    const many = [
      slot(9, 1, T(9), T(9, 30), [1]), // running at 09:10
      slot(5, 1, T(15), T(16), [1]),
      slot(3, 2, T(12), T(13), [2]),
      slot(4, 2, T(12), T(13), [3]), // same start: ordered by id
      slot(6, 1, T(17), T(18), [1]),
      slot(7, 1, T(18), T(19), [1]),
      slot(8, 1, T(19), T(20), [1]),
    ];
    const at = Date.parse(T(9, 10));
    expect(upcomingSlots(many, at).map((s) => s.id)).toEqual([3, 4, 5, 6, 7]);
    expect(upcomingSlots(many, at, 2).map((s) => s.id)).toEqual([3, 4]);
    expect(upcomingSlots(many, Date.parse(T(20)))).toEqual([]);
  });
});
