import { describe, expect, it } from "vitest";
import { CreateSlotBodySchema, SlotRangeQuerySchema } from "./slots.js";
import { isFiveMinuteAligned, isRunning, overlaps, roundToFiveMinutes } from "./time.js";

describe("roundToFiveMinutes", () => {
  it("rounds to the nearest boundary with ties going up", () => {
    expect(roundToFiveMinutes("2026-11-02T12:02:29.999Z")).toBe("2026-11-02T12:00:00.000Z");
    expect(roundToFiveMinutes("2026-11-02T12:02:30.000Z")).toBe("2026-11-02T12:05:00.000Z");
    expect(roundToFiveMinutes("2026-11-02T12:04:59.000Z")).toBe("2026-11-02T12:05:00.000Z");
    expect(roundToFiveMinutes("2026-11-02T12:05:00.000Z")).toBe("2026-11-02T12:05:00.000Z");
    expect(roundToFiveMinutes("2026-11-02T23:58:00.000Z")).toBe("2026-11-03T00:00:00.000Z");
  });

  it("supports floor and ceil", () => {
    expect(roundToFiveMinutes("2026-11-02T12:04:59.000Z", "floor")).toBe(
      "2026-11-02T12:00:00.000Z",
    );
    expect(roundToFiveMinutes("2026-11-02T12:00:01.000Z", "ceil")).toBe("2026-11-02T12:05:00.000Z");
    expect(roundToFiveMinutes("2026-11-02T12:00:00.000Z", "ceil")).toBe("2026-11-02T12:00:00.000Z");
  });

  it("operates on UTC instants, so a DST transition day is unremarkable", () => {
    // 2026-03-08 is the US spring-forward day; UTC does not care.
    expect(roundToFiveMinutes("2026-03-08T06:57:30.000Z")).toBe("2026-03-08T07:00:00.000Z");
    expect(roundToFiveMinutes("2026-03-08T07:02:29.000Z")).toBe("2026-03-08T07:00:00.000Z");
    expect(roundToFiveMinutes("2026-11-01T05:58:00-04:00")).toBe("2026-11-01T10:00:00.000Z");
  });

  it("accepts offsets and rejects garbage", () => {
    expect(roundToFiveMinutes("2026-11-02T13:02:00-05:00")).toBe("2026-11-02T18:00:00.000Z");
    expect(() => roundToFiveMinutes("yesterday")).toThrow(RangeError);
    expect(isFiveMinuteAligned("2026-11-02T12:05:00.000Z")).toBe(true);
    expect(isFiveMinuteAligned("2026-11-02T12:05:00.001Z")).toBe(false);
  });
});

describe("overlaps / isRunning", () => {
  const a = { start_at: "2026-11-02T10:00:00.000Z", end_at: "2026-11-02T11:00:00.000Z" };
  it("treats touching edges as free", () => {
    expect(
      overlaps(a, { start_at: "2026-11-02T11:00:00.000Z", end_at: "2026-11-02T12:00:00.000Z" }),
    ).toBe(false);
    expect(
      overlaps(a, { start_at: "2026-11-02T09:00:00.000Z", end_at: "2026-11-02T10:00:00.000Z" }),
    ).toBe(false);
  });
  it("detects partial, nested, and identical overlaps", () => {
    expect(
      overlaps(a, { start_at: "2026-11-02T10:59:00.000Z", end_at: "2026-11-02T12:00:00.000Z" }),
    ).toBe(true);
    expect(
      overlaps(a, { start_at: "2026-11-02T10:15:00.000Z", end_at: "2026-11-02T10:30:00.000Z" }),
    ).toBe(true);
    expect(
      overlaps(a, { start_at: "2026-11-02T09:00:00.000Z", end_at: "2026-11-02T13:00:00.000Z" }),
    ).toBe(true);
    expect(overlaps(a, a)).toBe(true);
  });
  it("isRunning is start-inclusive, end-exclusive", () => {
    expect(isRunning(a, "2026-11-02T10:00:00.000Z")).toBe(true);
    expect(isRunning(a, "2026-11-02T10:59:59.000Z")).toBe(true);
    expect(isRunning(a, "2026-11-02T11:00:00.000Z")).toBe(false);
    expect(isRunning(a, "2026-11-02T09:59:59.000Z")).toBe(false);
  });
});

describe("slot schemas", () => {
  it("dedupes printer ids and bounds the range query", () => {
    const body = CreateSlotBodySchema.parse({
      name: " Benchy ",
      start_at: "2026-11-02T10:00:00.000Z",
      end_at: "2026-11-02T11:00:00.000Z",
      printer_ids: [2, 1, 2],
    });
    expect(body.name).toBe("Benchy");
    expect(body.printer_ids).toEqual([2, 1]);
    expect(() => CreateSlotBodySchema.parse({ ...body, printer_ids: [] })).toThrow();
    expect(() =>
      SlotRangeQuerySchema.parse({
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-03-05T00:00:00.000Z",
      }),
    ).toThrow(/62/);
    expect(() =>
      SlotRangeQuerySchema.parse({
        from: "2026-01-02T00:00:00.000Z",
        to: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/after/);
  });
});
