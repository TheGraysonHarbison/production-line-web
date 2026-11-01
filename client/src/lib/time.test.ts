import { describe, expect, it } from "vitest";
import {
  dayBounds,
  dayTicks,
  formatDayParts,
  formatRange,
  formatTime,
  inputsFromIso,
  isoFromInputs,
  minutesInto,
  monthGrid,
  plainDateOf,
  rangeDays,
  rangeTicks,
  snapIsoToFive,
  snapMinutes,
  stripEnd,
  stripOrigin,
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

describe("timeline strip", () => {
  // 15:50 on Mon Nov 2 in New York (EST).
  const now = Date.parse("2026-11-02T20:50:00.000Z");

  it("starts on the hour at least an hour before now for today and future days", () => {
    // 14:50 floors to 14:00 EST = 19:00Z.
    expect(stripOrigin("2026-11-02", NY, now)).toBe("2026-11-02T19:00:00.000Z");
    expect(stripOrigin("2026-11-20", NY, now)).toBe("2026-11-02T19:00:00.000Z");
    expect(stripOrigin("2026-11-02", NY, now, 10)).toBe("2026-11-02T20:00:00.000Z");
  });
  it("starts at the day itself for days before the lead-in's day", () => {
    expect(stripOrigin("2026-11-01", NY, now)).toBe("2026-11-01T04:00:00.000Z");
    // Just after midnight the lead-in is yesterday evening; today still starts there.
    const early = Date.parse("2026-11-03T05:20:00.000Z"); // 00:20 EST Nov 3
    expect(stripOrigin("2026-11-03", NY, early)).toBe("2026-11-03T04:00:00.000Z"); // 23:00 Nov 2
    expect(stripOrigin("2026-11-02", NY, early)).toBe("2026-11-02T05:00:00.000Z");
  });
  it("ends at the end of the day the 30-day horizon lands on", () => {
    expect(stripEnd(NY, now)).toBe("2026-12-03T05:00:00.000Z");
    expect(stripEnd("UTC", now)).toBe("2026-12-03T00:00:00.000Z");
  });
  it("lists the days a range touches with their offsets, DST included", () => {
    // 15:00 EDT Oct 31 → midnight EST Nov 2; Nov 1 is 25 hours long.
    const days = rangeDays("2026-10-31T19:00:00.000Z", "2026-11-02T05:00:00.000Z", NY);
    expect(days).toEqual([
      { date: "2026-10-31", minute: 0 },
      { date: "2026-11-01", minute: 540 },
    ]);
    expect(rangeDays("2026-11-02T05:00:00.000Z", "2026-11-02T05:00:00.000Z", NY)).toEqual([
      { date: "2026-11-02", minute: 0 },
    ]);
  });
  it("ticks every real hour across days and flags midnight", () => {
    const ticks = rangeTicks("2026-10-31T19:00:00.000Z", "2026-11-02T05:00:00.000Z", NY, "12h");
    expect(ticks).toHaveLength(9 + 25);
    expect(ticks[0]).toMatchObject({
      minute: 0,
      label: "3 PM",
      date: "2026-10-31",
      dayStart: false,
    });
    expect(ticks[9]).toMatchObject({
      minute: 540,
      label: "12 AM",
      date: "2026-11-01",
      dayStart: true,
    });
    expect(ticks.filter((t) => t.dayStart)).toHaveLength(1);
    expect(ticks.slice(10, 13).map((t) => t.label)).toEqual(["1 AM", "1 AM", "2 AM"]);
    // Consecutive ticks are always 60 minutes apart, so a repeating gradient can draw them.
    for (let i = 1; i < ticks.length; i++) {
      expect((ticks[i]?.minute ?? 0) - (ticks[i - 1]?.minute ?? 0)).toBe(60);
    }
  });
  it("splits a date into the pieces the narrow markers show", () => {
    expect(formatDayParts("2026-11-02")).toEqual({ weekday: "Mon", day: "Nov 2" });
  });
});
