import type { TimeFormat } from "@production-line/shared";
import { FIVE_MINUTES_MS } from "@production-line/shared";
import { Temporal } from "temporal-polyfill";

/**
 * All client date math goes through here (dev doc §10): instants are UTC ISO strings, the app
 * timezone (settings) decides the wall clock, and the user's time_format decides 12h/24h.
 */

export type PlainDateString = `${number}-${number}-${number}` | string;

export function toZoned(iso: string, tz: string): Temporal.ZonedDateTime {
  return Temporal.Instant.from(iso).toZonedDateTimeISO(tz);
}

export function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

/** Today's calendar date in the app timezone, e.g. "2026-11-02". */
export function todayPlainDate(tz: string, now: number = Date.now()): string {
  return toZoned(isoFromMs(now), tz).toPlainDate().toString();
}

/** The calendar date (in tz) an instant falls on. */
export function plainDateOf(iso: string, tz: string): string {
  return toZoned(iso, tz).toPlainDate().toString();
}

export interface DayBounds {
  from: string;
  to: string;
  minutes: number;
  hours: number;
}

/** Start and end instants of a calendar day in tz. DST days are 23 or 25 hours long. */
export function dayBounds(date: string, tz: string): DayBounds {
  const start = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: tz });
  const end = start.add({ days: 1 });
  const minutes = (end.epochMilliseconds - start.epochMilliseconds) / 60_000;
  return {
    from: isoFromMs(start.epochMilliseconds),
    to: isoFromMs(end.epochMilliseconds),
    minutes,
    hours: minutes / 60,
  };
}

export interface Tick {
  iso: string;
  /** Minutes since the start of the day. */
  minute: number;
  label: string;
}

/** One tick per wall-clock hour boundary in the day (23/24/25 of them). */
export function dayTicks(date: string, tz: string, fmt: TimeFormat): Tick[] {
  const start = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: tz });
  const end = start.add({ days: 1 });
  const ticks: Tick[] = [];
  let t = start;
  while (t.epochMilliseconds < end.epochMilliseconds) {
    const iso = isoFromMs(t.epochMilliseconds);
    ticks.push({
      iso,
      minute: (t.epochMilliseconds - start.epochMilliseconds) / 60_000,
      label: formatTime(iso, tz, fmt, true),
    });
    t = t.add({ hours: 1 });
  }
  return ticks;
}

export function addDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

export function minutesInto(iso: string, dayFrom: string): number {
  return (Date.parse(iso) - Date.parse(dayFrom)) / 60_000;
}

export function snapMinutes(
  minutes: number,
  mode: "nearest" | "floor" | "ceil" = "nearest",
): number {
  const q = minutes / 5;
  const r = mode === "floor" ? Math.floor(q) : mode === "ceil" ? Math.ceil(q) : Math.round(q);
  return r * 5;
}

export function snapIsoToFive(iso: string, mode: "nearest" | "floor" | "ceil" = "nearest"): string {
  const q = Date.parse(iso) / FIVE_MINUTES_MS;
  const r = mode === "floor" ? Math.floor(q) : mode === "ceil" ? Math.ceil(q) : Math.round(q);
  return isoFromMs(r * FIVE_MINUTES_MS);
}

/** "1:30 PM" / "13:30". `short` drops ":00" minutes for tick labels in 12h mode ("1 PM"). */
export function formatTime(iso: string, tz: string, fmt: TimeFormat, short = false): string {
  const d = new Date(iso);
  const hour12 = fmt === "12h";
  if (short && hour12 && d.getUTCSeconds() === 0) {
    const z = toZoned(iso, tz);
    if (z.minute === 0)
      return new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        hour12: true,
      }).format(d);
  }
  return new Intl.DateTimeFormat(hour12 ? "en-US" : "en-GB", {
    timeZone: tz,
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12,
  }).format(d);
}

export function formatDate(date: string, style: "long" | "short" = "long"): string {
  const pd = Temporal.PlainDate.from(date);
  return new Intl.DateTimeFormat("en-US", {
    weekday: style === "long" ? "long" : "short",
    month: style === "long" ? "long" : "short",
    day: "numeric",
    year: style === "long" ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(pd.year, pd.month - 1, pd.day)));
}

export function formatMonth(yearMonth: string): string {
  const ym = Temporal.PlainYearMonth.from(yearMonth);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)));
}

export function formatRange(startIso: string, endIso: string, tz: string, fmt: TimeFormat): string {
  const sameDay = plainDateOf(startIso, tz) === plainDateOf(endIso, tz);
  const end = sameDay
    ? formatTime(endIso, tz, fmt)
    : `${formatDate(plainDateOf(endIso, tz), "short")} ${formatTime(endIso, tz, fmt)}`;
  return `${formatTime(startIso, tz, fmt)} – ${end}`;
}

/** Converts `<input type=date>` + `<input type=time>` values (wall clock in tz) to a UTC instant. */
export function isoFromInputs(date: string, time: string, tz: string): string {
  const zdt = Temporal.PlainDate.from(date).toZonedDateTime({
    timeZone: tz,
    plainTime: Temporal.PlainTime.from(time),
  });
  return isoFromMs(zdt.epochMilliseconds);
}

/** Splits an instant into `<input type=date>` / `<input type=time>` values in tz. */
export function inputsFromIso(iso: string, tz: string): { date: string; time: string } {
  const z = toZoned(iso, tz);
  return {
    date: z.toPlainDate().toString(),
    time: z.toPlainTime().toString({ smallestUnit: "minute" }),
  };
}

export interface MonthGrid {
  yearMonth: string;
  /** Rows of 7 ISO dates, Monday first, padded with the neighbouring months. */
  weeks: string[][];
  from: string;
  to: string;
}

/** A Monday-first month grid plus the instant range covering it (for one slots query). */
export function monthGrid(yearMonth: string, tz: string): MonthGrid {
  const ym = Temporal.PlainYearMonth.from(yearMonth);
  const first = ym.toPlainDate({ day: 1 });
  const lead = first.dayOfWeek - 1; // Monday = 1
  let cursor = first.subtract({ days: lead });
  const weeks: string[][] = [];
  do {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cursor.toString());
      cursor = cursor.add({ days: 1 });
    }
    weeks.push(week);
  } while (cursor.year < ym.year || (cursor.year === ym.year && cursor.month <= ym.month));
  const firstDay = weeks[0]?.[0] as string;
  const lastRow = weeks[weeks.length - 1] as string[];
  const lastDay = lastRow[6] as string;
  return { yearMonth, weeks, from: dayBounds(firstDay, tz).from, to: dayBounds(lastDay, tz).to };
}

export function shiftMonth(yearMonth: string, months: number): string {
  return Temporal.PlainYearMonth.from(yearMonth).add({ months }).toString();
}

export function yearMonthOf(date: string): string {
  return Temporal.PlainDate.from(date).toPlainYearMonth().toString();
}
