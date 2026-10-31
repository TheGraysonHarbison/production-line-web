import { describe, expect, it } from "vitest";
import {
  dayBounds,
  dayTicks,
  formatRange,
  formatTime,
  inputsFromIso,
  isoFromInputs,
  minutesInto,
  monthGrid,
  plainDateOf,
  snapIsoToFive,
  snapMinutes,
  todayPlainDate,
} from "./time.ts";

const NY = "America/New_York";

describe("formatTime", () => {
  it("renders 12h and 24h in the app timezone", () => {
    expect(formatTime("2026-11-02T18:30:00.000Z", NY, "12h")).toBe("1:30 PM");
    expect(formatTime("2026-11-02T18:30:00.000Z", NY, "24h")).toBe("13:30");
    expect(formatTime("2026-11-02T05:05:00.000Z", NY, "12h")).toBe("12:05 AM");
    expect(formatTime("2026-11-02T05:05:00.000Z", "UTC", "24h")).toBe("05:05");
    expect(formatTime("2026-11-02T18:00:00.000Z", NY, "12h", true)).toBe("1 PM");
    expect(formatTime("2026-11-02T18:00:00.000Z", NY, "24h", true)).toBe("13:00");
  });
  it("formats ranges, noting a different end day", () => {
    expect(formatRange("2026-11-02T18:00:00.000Z", "2026-11-02T21:30:00.000Z", NY, "12h")).toBe(
      "1:00 PM – 4:30 PM",
    );
    expect(formatRange("2026-11-02T23:00:00.000Z", "2026-11-03T06:00:00.000Z", NY, "24h")).toBe(
      "18:00 – Tue, Nov 3 01:00",
    );
  });
});

describe("day bounds and ticks across DST", () => {
  it("regular day: 24 hours", () => {
    const b = dayBounds("2026-11-02", NY);
    expect(b).toMatchObject({
      from: "2026-11-02T05:00:00.000Z",
      to: "2026-11-03T05:00:00.000Z",
      hours: 24,
      minutes: 1440,
    });
    expect(dayTicks("2026-11-02", NY, "24h")).toHaveLength(24);
  });
  it("spring forward: 23 hours, 23 ticks", () => {
    const b = dayBounds("2026-03-08", NY);
    expect(b.hours).toBe(23);
    const ticks = dayTicks("2026-03-08", NY, "12h");
    expect(ticks).toHaveLength(23);
    expect(ticks.map((t) => t.label).slice(0, 4)).toEqual(["12 AM", "1 AM", "3 AM", "4 AM"]);
    expect(ticks[2]?.minute).toBe(120);
  });
  it("fall back: 25 hours, 25 ticks", () => {
    expect(dayBounds("2026-11-01", NY).hours).toBe(25);
    const ticks = dayTicks("2026-11-01", NY, "24h");
    expect(ticks).toHaveLength(25);
    expect(ticks.map((t) => t.label).slice(0, 4)).toEqual(["00:00", "01:00", "01:00", "02:00"]);
  });
  it("UTC never shifts", () => {
    expect(dayBounds("2026-03-08", "UTC").hours).toBe(24);
    expect(minutesInto("2026-03-08T10:30:00.000Z", dayBounds("2026-03-08", "UTC").from)).toBe(630);
  });
});

describe("snapping and conversions", () => {
  it("snaps minutes and instants to the 5-minute grid", () => {
    expect(snapMinutes(12)).toBe(10);
    expect(snapMinutes(13)).toBe(15);
    expect(snapMinutes(12.5)).toBe(15);
    expect(snapMinutes(14, "floor")).toBe(10);
    expect(snapMinutes(11, "ceil")).toBe(15);
    expect(snapIsoToFive("2026-11-02T18:02:29.000Z")).toBe("2026-11-02T18:00:00.000Z");
    expect(snapIsoToFive("2026-11-02T18:02:31.000Z")).toBe("2026-11-02T18:05:00.000Z");
  });
  it("round-trips wall-clock inputs through the app timezone", () => {
    const iso = isoFromInputs("2026-11-02", "13:30", NY);
    expect(iso).toBe("2026-11-02T18:30:00.000Z");
    expect(inputsFromIso(iso, NY)).toEqual({ date: "2026-11-02", time: "13:30" });
    expect(plainDateOf("2026-11-03T03:00:00.000Z", NY)).toBe("2026-11-02");
    expect(todayPlainDate(NY, Date.parse("2026-11-03T03:00:00.000Z"))).toBe("2026-11-02");
  });
});

describe("monthGrid", () => {
  it("builds Monday-first weeks covering the whole month", () => {
    const g = monthGrid("2026-11", NY);
    expect(g.weeks[0]?.[0]).toBe("2026-10-26");
    expect(g.weeks[0]?.[6]).toBe("2026-11-01");
    expect(g.weeks.at(-1)?.[6]).toBe("2026-12-06");
    expect(g.weeks).toHaveLength(6);
    expect(g.from).toBe(dayBounds("2026-10-26", NY).from);
    expect(g.to).toBe(dayBounds("2026-12-06", NY).to);
    expect(monthGrid("2026-06", "UTC").weeks).toHaveLength(5);
  });
});
