import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExpiryScheduler } from "../src/services/expiry.js";
import { HaClient } from "../src/services/ha.js";
import type { UserRow } from "../src/services/users.js";
import { request, seedRoles } from "./auth-helpers.js";
import { createTestApp, type TestApp } from "./helpers.js";

const MIN = 60_000;

/** A fetch stub that answers with the given statuses in order (last repeats) and records calls. */
function fetchStub(statuses: number[]) {
  const calls: { url: string; body: unknown }[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    const status = statuses.length > 1 ? (statuses.shift() as number) : (statuses[0] ?? 200);
    return new Response("{}", { status });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("ExpiryScheduler", () => {
  let t: TestApp;
  let user: UserRow;
  /** One printer per slot: overlapping bookings on one printer are refused by design. */
  let printers: number[];
  let nextPrinter = 0;
  let logs: { level: string; obj: unknown; msg: string }[];
  const T0 = Date.parse("2026-11-02T20:00:00.000Z");

  beforeEach(async () => {
    t = await createTestApp();
    const roles = await seedRoles(t);
    user = t.ctx.users.findById(roles.user.me.id) as UserRow;
    printers = [];
    nextPrinter = 0;
    for (const name of ["Prusa", "Bambu", "Voron"]) {
      const res = await request(t, "POST", "/api/printers", {
        cookie: roles.admin.cookie,
        body: { name },
      });
      printers.push(res.json().id);
    }
    logs = [];
    for (const level of ["info", "warn", "error", "debug"] as const) {
      (t.ctx.log as unknown as Record<string, unknown>)[level] = (obj: unknown, msg: string) => {
        logs.push({ level, obj, msg });
      };
    }
    vi.useFakeTimers({ now: T0 });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await t.cleanup();
  });

  /** Creates a slot [start, end] minutes relative to T0, validated as of `asOf` minutes. */
  const slotAt = (startMin: number, endMin: number, asOf = startMin - 30, name = "Benchy") =>
    t.ctx.slots.create(
      user,
      {
        name,
        description: null,
        start_at: new Date(T0 + startMin * MIN).toISOString(),
        end_at: new Date(T0 + endMin * MIN).toISOString(),
        printer_ids: [printers[nextPrinter++ % printers.length] as number],
      },
      new Date(T0 + asOf * MIN),
    );

  const scheduler = (fetch: typeof fetch, backoffMs: number[] = [2_000, 8_000]) =>
    new ExpiryScheduler({
      slots: t.ctx.slots,
      settings: t.ctx.settings,
      ha: new HaClient(t.ctx.settings, t.ctx.log, { fetch, backoffMs }),
      log: t.ctx.log,
    });

  const enableHa = () =>
    t.ctx.settings.update({
      ha_enabled: true,
      ha_base_url: "http://ha.test:8123",
      ha_token: "tok",
    });

  it("expires a slot on the first tick after end_at, emitting slot.expired once", async () => {
    const slot = slotAt(5, 10);
    const expired: number[] = [];
    t.ctx.events.on("slot.expired", ({ slot: s }) => expired.push(s.id));
    const s = scheduler(fetchStub([200]).impl);
    await s.start();
    expect(
      t.ctx.slots.listRange("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z"),
    ).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(9 * MIN + 59_000); // 20:09:59, slot ends 20:10
    expect(expired).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000); // the tick at 20:10:29
    expect(expired).toEqual([slot.id]);
    expect(() => t.ctx.slots.get(slot.id)).toThrow();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(expired).toEqual([slot.id]);
    expect(logs.filter((l) => l.msg === "expiry.processed")).toEqual([
      {
        level: "info",
        obj: { slotId: slot.id, ha: "skipped", haStatus: null, attempts: 0, catchUp: false },
        msg: "expiry.processed",
      },
    ]);
    await s.stop();
  });

  it("processes several expired slots in end_at order and delivers each to HA", async () => {
    const b = slotAt(5, 20, -30, "B");
    const a = slotAt(5, 15, -30, "A");
    const c = slotAt(5, 25, -30, "C");
    enableHa();
    const fetch = fetchStub([200]);
    const s = scheduler(fetch.impl);
    await s.start();
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(fetch.calls.map((x) => (x.body as { slot: { name: string } }).slot.name)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(fetch.calls.map((x) => x.url)).toEqual(
      Array(3).fill("http://ha.test:8123/api/events/production_line_slot_expired"),
    );
    const first = fetch.calls[0]?.body as {
      slot: { id: number };
      catch_up: boolean;
      expired_at: string;
    };
    expect(first.slot.id).toBe(a.id);
    expect(first.catch_up).toBe(false);
    // Stamped at processing time (the tick after 20:15), never before the slot's end.
    expect(Date.parse(first.expired_at)).toBeGreaterThanOrEqual(T0 + 15 * MIN);
    expect(first.expired_at).toMatch(/^2026-11-02T20:\d\d:\d\dZ$/);
    for (const id of [a.id, b.id, c.id]) expect(() => t.ctx.slots.get(id)).toThrow();
    await s.stop();
  });

  it("catches up on boot: already-expired slots go out with catch_up: true and are logged by id", async () => {
    const x = slotAt(-60, -30, -90, "X");
    const y = slotAt(-50, -20, -90, "Y");
    enableHa();
    const fetch = fetchStub([200]);
    const expired: number[] = [];
    t.ctx.events.on("slot.expired", ({ slot: s }) => expired.push(s.id));
    const s = scheduler(fetch.impl);
    await s.start();
    expect(expired).toEqual([x.id, y.id]);
    expect(fetch.calls.map((c) => (c.body as { catch_up: boolean }).catch_up)).toEqual([
      true,
      true,
    ]);
    expect(logs.find((l) => l.msg === "expiry.catchup")).toEqual({
      level: "info",
      obj: { count: 2, ids: [x.id, y.id] },
      msg: "expiry.catchup",
    });
    await s.stop();
  });

  it("retries HA with 2 s / 8 s backoff when it fails twice, then deletes", async () => {
    const slot = slotAt(-20, -10, -30);
    enableHa();
    const fetch = fetchStub([500, 500, 200]);
    const s = scheduler(fetch.impl);
    const started = s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetch.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(fetch.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch.calls).toHaveLength(3);
    await started;
    expect(() => t.ctx.slots.get(slot.id)).toThrow();
    expect(logs.find((l) => l.msg === "expiry.processed")?.obj).toMatchObject({
      ha: "sent",
      haStatus: 200,
      attempts: 3,
    });
    await s.stop();
  });

  it("after three failures logs the payload and still deletes the slot", async () => {
    const slot = slotAt(-20, -10, -30);
    enableHa();
    const fetch = fetchStub([503]);
    const s = scheduler(fetch.impl);
    const started = s.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await started;
    expect(fetch.calls).toHaveLength(3);
    expect(() => t.ctx.slots.get(slot.id)).toThrow();
    const failed = logs.find((l) => l.msg === "ha.delivery_failed");
    expect(failed?.level).toBe("warn");
    expect(failed?.obj).toMatchObject({
      attempts: 3,
      httpStatus: 503,
      payload: { slot: { id: slot.id, name: "Benchy" }, catch_up: true },
    });
    expect(logs.find((l) => l.msg === "expiry.processed")?.obj).toMatchObject({
      ha: "failed",
      haStatus: 503,
    });
    await s.stop();
  });

  it("skips delivery entirely while HA is disabled, even with URL and token set", async () => {
    slotAt(-20, -10, -30);
    t.ctx.settings.update({ ha_enabled: false, ha_base_url: "http://ha.test", ha_token: "tok" });
    const fetch = fetchStub([200]);
    const s = scheduler(fetch.impl);
    await s.start();
    expect(fetch.calls).toHaveLength(0);
    expect(logs.find((l) => l.msg === "expiry.processed")?.obj).toMatchObject({ ha: "skipped" });
    await s.stop();
  });

  it("stop() waits for the slot in flight and leaves the rest for the next boot", async () => {
    const first = slotAt(-40, -30, -60, "first");
    const second = slotAt(-30, -20, -60, "second");
    enableHa();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fetch = vi.fn(async () => {
      await gate;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const s = scheduler(fetch);
    const started = s.start();
    await vi.advanceTimersByTimeAsync(0);
    const stopping = s.stop();
    release();
    await stopping;
    await started;
    expect(() => t.ctx.slots.get(first.id)).toThrow();
    expect(t.ctx.slots.get(second.id).name).toBe("second");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.ctx.slots.get(second.id).name).toBe("second");
  });

  it("copes with a slot deleted by hand while HA is being notified", async () => {
    const slot = slotAt(-20, -10, -30);
    enableHa();
    const fetch = vi.fn(async () => {
      t.ctx.slots.delete(slot.id, "manual");
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const expired: string[] = [];
    t.ctx.events.onAny((n) => expired.push(n));
    const s = scheduler(fetch);
    await s.start();
    expect(expired).toEqual(["slot.deleted"]);
    expect(logs.some((l) => l.msg === "expiry.vanished")).toBe(true);
    await s.stop();
  });
});
