/** Slot timing constants (dev doc §3.3). All math is on UTC instants; timezones are a display concern. */
export const FIVE_MINUTES_MS = 5 * 60 * 1000;
export const SLOT_MIN_LENGTH_MS = FIVE_MINUTES_MS;
export const SLOT_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;
export const RANGE_QUERY_MAX_MS = 62 * 24 * 60 * 60 * 1000;

export type RoundingMode = "nearest" | "floor" | "ceil";

/** Rounds an ISO-8601 instant to a 5-minute boundary. Ties round up (12:02:30 → 12:05). */
export function roundToFiveMinutes(iso: string, mode: RoundingMode = "nearest"): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`invalid instant: ${iso}`);
  const q = ms / FIVE_MINUTES_MS;
  const rounded =
    mode === "floor" ? Math.floor(q) : mode === "ceil" ? Math.ceil(q) : Math.floor(q + 0.5);
  return new Date(rounded * FIVE_MINUTES_MS).toISOString();
}

export function isFiveMinuteAligned(iso: string): boolean {
  const ms = Date.parse(iso);
  return !Number.isNaN(ms) && ms % FIVE_MINUTES_MS === 0;
}

export interface Interval {
  start_at: string;
  end_at: string;
}

/** Half-open overlap: touching edges (a.end == b.start) do not overlap (dev doc §3.3). */
export function overlaps(a: Interval, b: Interval): boolean {
  return (
    Date.parse(a.start_at) < Date.parse(b.end_at) && Date.parse(a.end_at) > Date.parse(b.start_at)
  );
}

/** A slot is running when start_at <= now < end_at. */
export function isRunning(slot: Interval, nowIso: string): boolean {
  const now = Date.parse(nowIso);
  return Date.parse(slot.start_at) <= now && now < Date.parse(slot.end_at);
}

export function isExpired(slot: Interval, nowIso: string): boolean {
  return Date.parse(slot.end_at) <= Date.parse(nowIso);
}
