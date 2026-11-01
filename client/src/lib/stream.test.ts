import type { Printer, Slot } from "@production-line/shared";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { meQueryKey } from "./auth.tsx";
import { printersQueryKey, slotsQueryKey, usersQueryKey } from "./data.ts";
import { applyStreamEvent } from "./stream.ts";
import { clearToasts, dismissToast, getToasts } from "./toast.ts";

const user = { id: 1, username: "sam", color: "#4f9cff", role: "user" as const, avatar_url: null };
const printer = (id: number, name: string): Printer => ({
  id,
  name,
  invisible: false,
  created_at: "2026-01-01T00:00:00.000Z",
});
const slot = (id: number, start: string, end: string): Slot => ({
  id,
  user,
  name: `S${id}`,
  description: null,
  start_at: start,
  end_at: end,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  printers: [printer(1, "P")],
  images: [],
});

describe("applyStreamEvent", () => {
  it("upserts slots into range queries they overlap and removes them from ones they don't", () => {
    const qc = new QueryClient();
    const dayKey = slotsQueryKey.range("2026-11-02T00:00:00.000Z", "2026-11-03T00:00:00.000Z");
    const nextKey = slotsQueryKey.range("2026-11-03T00:00:00.000Z", "2026-11-04T00:00:00.000Z");
    qc.setQueryData(dayKey, [slot(1, "2026-11-02T10:00:00.000Z", "2026-11-02T11:00:00.000Z")]);
    qc.setQueryData(nextKey, []);

    applyStreamEvent(
      qc,
      "slot.created",
      { slot: slot(2, "2026-11-02T08:00:00.000Z", "2026-11-02T09:00:00.000Z") },
      1,
    );
    expect(qc.getQueryData<Slot[]>(dayKey)?.map((s) => s.id)).toEqual([2, 1]);
    expect(qc.getQueryData<Slot[]>(nextKey)).toEqual([]);

    // Moving slot 1 into the next day removes it here and adds it there.
    applyStreamEvent(
      qc,
      "slot.updated",
      { slot: slot(1, "2026-11-03T10:00:00.000Z", "2026-11-03T11:00:00.000Z") },
      1,
    );
    expect(qc.getQueryData<Slot[]>(dayKey)?.map((s) => s.id)).toEqual([2]);
    expect(qc.getQueryData<Slot[]>(nextKey)?.map((s) => s.id)).toEqual([1]);

    applyStreamEvent(qc, "slot.expired", { slot: slot(2, "x", "y") }, 1);
    expect(qc.getQueryData<Slot[]>(dayKey)).toEqual([]);
  });

  it("keeps the printers list sorted and drops deleted printers", () => {
    const qc = new QueryClient();
    qc.setQueryData(printersQueryKey, [printer(1, "Bambu"), printer(2, "Prusa")]);
    applyStreamEvent(qc, "printer.created", { printer: printer(3, "ender") }, 1);
    expect(qc.getQueryData<Printer[]>(printersQueryKey)?.map((p) => p.name)).toEqual([
      "Bambu",
      "ender",
      "Prusa",
    ]);
    applyStreamEvent(
      qc,
      "printer.updated",
      { printer: { ...printer(2, "Prusa"), invisible: true } },
      1,
    );
    expect(qc.getQueryData<Printer[]>(printersQueryKey)?.find((p) => p.id === 2)?.invisible).toBe(
      true,
    );
    applyStreamEvent(qc, "printer.deleted", { printer: printer(1, "Bambu") }, 1);
    expect(qc.getQueryData<Printer[]>(printersQueryKey)?.map((p) => p.id)).toEqual([3, 2]);
  });

  it("signs the current user out when they are deleted, and patches the users list", () => {
    const qc = new QueryClient();
    qc.setQueryData(meQueryKey, { ...user, time_format: "12h", created_at: "x" });
    qc.setQueryData(usersQueryKey, [user, { ...user, id: 2, username: "kim" }]);
    applyStreamEvent(
      qc,
      "user.updated",
      { user: { ...user, id: 2, username: "kim", role: "admin" } },
      1,
    );
    expect(qc.getQueryData<(typeof user)[]>(usersQueryKey)?.[1]?.role).toBe("admin");
    applyStreamEvent(qc, "user.deleted", { user: { ...user, id: 2 } }, 1);
    expect(qc.getQueryData<(typeof user)[]>(usersQueryKey)?.map((u) => u.id)).toEqual([1]);
    expect(qc.getQueryData(meQueryKey)).not.toBeNull();
    applyStreamEvent(qc, "user.deleted", { user }, 1);
    expect(qc.getQueryData(meQueryKey)).toBeNull();
  });
});

describe("expiry toast", () => {
  // Earlier tests in this file expire slots too; start from an empty store.
  beforeEach(() => clearToasts());
  afterEach(() => clearToasts());

  it("tells the owner, and only the owner, when their slot expires", () => {
    const qc = new QueryClient();
    const key = slotsQueryKey.range("2026-11-02T00:00:00.000Z", "2026-11-03T00:00:00.000Z");
    const s = slot(7, "2026-11-02T10:00:00.000Z", "2026-11-02T11:00:00.000Z");
    qc.setQueryData(key, [s]);
    // Someone else's slot: removed, no toast.
    applyStreamEvent(qc, "slot.expired", { slot: s }, 99);
    expect(qc.getQueryData(key)).toEqual([]);
    expect(getToasts()).toEqual([]);
    // Mine: a toast naming the slot and printer, dismissable.
    applyStreamEvent(qc, "slot.expired", { slot: s }, 1);
    expect(getToasts().map((t) => t.message)).toEqual(["S7 finished on P and left the schedule."]);
    dismissToast(getToasts()[0]?.id ?? -1);
    expect(getToasts()).toEqual([]);
  });
});
