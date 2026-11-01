import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Slot } from "@production-line/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildExpiredPayload, HaClient } from "../src/services/ha.js";
import { createTestContext, type TestContext } from "./helpers.js";

const slot: Slot = {
  id: 42,
  user: {
    id: 3,
    username: "sam",
    color: "#4f9cff",
    role: "user",
    time_format: "12h",
    avatar_url: null,
    created_at: "2026-10-01T00:00:00.000Z",
  },
  name: "Benchy batch",
  description: "PLA, 0.2mm",
  start_at: "2026-11-02T18:00:00.000Z",
  end_at: "2026-11-02T21:30:00.000Z",
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
  printers: [
    { id: 1, name: "Prusa MK4", invisible: false, created_at: "2026-10-01T00:00:00.000Z" },
    { id: 2, name: "Bambu P1S", invisible: false, created_at: "2026-10-01T00:00:00.000Z" },
  ],
  images: [],
};

describe("buildExpiredPayload", () => {
  it("matches dev doc §8 exactly", () => {
    expect(
      buildExpiredPayload(slot, "America/New_York", "2026-11-02T21:30:14.250Z", false),
    ).toEqual({
      slot: {
        id: 42,
        name: "Benchy batch",
        description: "PLA, 0.2mm",
        start_at: "2026-11-02T18:00:00Z",
        end_at: "2026-11-02T21:30:00Z",
        start_local: "2026-11-02T13:00:00-05:00",
        end_local: "2026-11-02T16:30:00-05:00",
        timezone: "America/New_York",
      },
      user: { id: 3, username: "sam", color: "#4f9cff" },
      printers: [
        { id: 1, name: "Prusa MK4" },
        { id: 2, name: "Bambu P1S" },
      ],
      expired_at: "2026-11-02T21:30:14Z",
      catch_up: false,
    });
  });

  it("gives each local time its own offset across the fall-back transition", () => {
    // 01:30 EDT Nov 1 → 02:30 EST Nov 1 (the slot spans the repeated hour).
    const dst = {
      ...slot,
      start_at: "2026-11-01T05:30:00.000Z",
      end_at: "2026-11-01T07:30:00.000Z",
    };
    const p = buildExpiredPayload(dst, "America/New_York", "2026-11-01T07:30:00.000Z", true);
    expect(p.slot.start_local).toBe("2026-11-01T01:30:00-04:00");
    expect(p.slot.end_local).toBe("2026-11-01T02:30:00-05:00");
    expect(p.catch_up).toBe(true);
  });

  it("uses UTC offsets of +00:00 for the UTC timezone", () => {
    expect(buildExpiredPayload(slot, "UTC", slot.end_at, false).slot.start_local).toBe(
      "2026-11-02T18:00:00+00:00",
    );
  });
});

interface MockHa {
  server: Server;
  url: string;
  calls: { path: string; auth: string | undefined; body: unknown }[];
  /** Status to answer with, popped per request; the last one repeats. */
  statuses: number[];
  close: () => Promise<void>;
}

async function mockHa(statuses: number[]): Promise<MockHa> {
  const calls: MockHa["calls"] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      calls.push({ path: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(raw) });
      const status = statuses.length > 1 ? (statuses.shift() as number) : (statuses[0] ?? 200);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: status < 300 ? "Event fired." : "nope" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    calls,
    statuses,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

describe("HaClient", () => {
  let tc: TestContext;
  let ha: MockHa | null = null;
  beforeEach(() => {
    tc = createTestContext();
  });
  afterEach(async () => {
    await ha?.close();
    ha = null;
    tc.cleanup();
  });

  const client = (backoffMs: number[] = [0, 0]) =>
    new HaClient(tc.ctx.settings, tc.ctx.log, { backoffMs });

  it("is enabled only with the toggle on and both URL and token set", () => {
    const c = client();
    expect(c.isEnabled()).toBe(false);
    tc.ctx.settings.update({ ha_enabled: true, ha_base_url: "http://ha.local:8123" });
    expect(c.isEnabled()).toBe(false);
    tc.ctx.settings.update({ ha_token: "tok" });
    expect(c.isEnabled()).toBe(true);
    tc.ctx.settings.update({ ha_enabled: false });
    expect(c.isEnabled()).toBe(false);
  });

  it("posts the event with the bearer token to {base}/api/events/{type}", async () => {
    ha = await mockHa([200]);
    tc.ctx.settings.update({
      ha_enabled: true,
      ha_base_url: `${ha.url}/`,
      ha_token: "secret-token",
    });
    const r = await client().fire("production_line_slot_expired", { hello: "world" });
    expect(r).toEqual({ status: "sent", httpStatus: 200, attempts: 1, error: null });
    expect(ha.calls).toHaveLength(1);
    expect(ha.calls[0]).toMatchObject({
      path: "/api/events/production_line_slot_expired",
      auth: "Bearer secret-token",
      body: { hello: "world" },
    });
  });

  it("retries twice with backoff when HA fails, then succeeds", async () => {
    ha = await mockHa([500, 503, 200]);
    tc.ctx.settings.update({ ha_enabled: true, ha_base_url: ha.url, ha_token: "t" });
    const r = await client([5, 5]).fire("production_line_slot_expired", { n: 1 });
    expect(r).toEqual({ status: "sent", httpStatus: 200, attempts: 3, error: null });
    expect(ha.calls).toHaveLength(3);
  });

  it("gives up after three failures, logging the payload, without throwing", async () => {
    ha = await mockHa([502]);
    tc.ctx.settings.update({ ha_enabled: true, ha_base_url: ha.url, ha_token: "t" });
    const warned: unknown[] = [];
    const log = tc.ctx.log.child({});
    log.warn = ((obj: unknown, msg?: string) => {
      warned.push({ obj, msg });
    }) as typeof log.warn;
    const c = new HaClient(tc.ctx.settings, log, { backoffMs: [0, 0] });
    const r = await c.fire("production_line_slot_expired", { replay: "me" });
    expect(r).toMatchObject({ status: "failed", httpStatus: 502, attempts: 3 });
    expect(ha.calls).toHaveLength(3);
    expect(warned).toEqual([
      {
        obj: expect.objectContaining({ payload: { replay: "me" }, httpStatus: 502, attempts: 3 }),
        msg: "ha.delivery_failed",
      },
    ]);
  });

  it("treats an unreachable host as a failed attempt, not an exception", async () => {
    tc.ctx.settings.update({ ha_enabled: true, ha_base_url: "http://127.0.0.1:1", ha_token: "t" });
    const r = await client().fire("production_line_slot_expired", {});
    expect(r.status).toBe("failed");
    expect(r.httpStatus).toBeNull();
    expect(r.error).toBeTruthy();
  });

  it("skips silently when URL or token is missing", async () => {
    tc.ctx.settings.update({ ha_enabled: true, ha_base_url: "http://ha.local" });
    expect(await client().fire("x", {})).toEqual({
      status: "skipped",
      httpStatus: null,
      attempts: 0,
      error: null,
    });
  });

  it("test() fires production_line_test once and reports the status; refuses when unconfigured", async () => {
    await expect(client().test()).rejects.toMatchObject({ code: "ha_not_configured" });
    ha = await mockHa([401]);
    tc.ctx.settings.update({ ha_base_url: ha.url, ha_token: "bad" });
    const r = await client().test();
    expect(r).toMatchObject({ status: "failed", httpStatus: 401, attempts: 1 });
    expect(ha.calls[0]?.path).toBe("/api/events/production_line_test");
    expect(ha.calls[0]?.body).toMatchObject({ source: "production-line-web" });
  });
});
