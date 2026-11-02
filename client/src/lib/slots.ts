import type { Me, Printer, PublicUser, Slot } from "@production-line/shared";
import { isRunning, overlaps, SLOT_HORIZON_MS } from "@production-line/shared";

export function canEditSlot(me: Me | null | undefined, slot: Pick<Slot, "user">): boolean {
  if (!me) return false;
  return me.id === slot.user.id || me.role === "admin" || me.role === "owner";
}

export interface PrinterConflict {
  printer: Printer;
  slot: Slot;
}

/**
 * Client-side pre-filter (dev doc §3.3): which printers already have a slot in [start, end),
 * ignoring `excludeSlotId`. The server remains the authority.
 */
export function findConflicts(
  slots: Slot[],
  printers: Printer[],
  range: { start_at: string; end_at: string },
  excludeSlotId?: number,
): Map<number, PrinterConflict> {
  const result = new Map<number, PrinterConflict>();
  for (const printer of printers) {
    const hit = slots.find(
      (s) =>
        s.id !== excludeSlotId && s.printers.some((p) => p.id === printer.id) && overlaps(s, range),
    );
    if (hit) result.set(printer.id, { printer, slot: hit });
  }
  return result;
}

/** Earliest start of any later slot sharing a printer with `slot` (the extension ceiling). */
export function nextSlotStart(slot: Slot, slots: Slot[]): string | null {
  const ids = new Set(slot.printers.map((p) => p.id));
  let next: string | null = null;
  for (const s of slots) {
    if (s.id === slot.id || !s.printers.some((p) => ids.has(p.id))) continue;
    if (Date.parse(s.start_at) < Date.parse(slot.end_at)) continue;
    if (next === null || Date.parse(s.start_at) < Date.parse(next)) next = s.start_at;
  }
  return next;
}

/** The furthest `end_at` an extension may reach: next slot, or the 30-day horizon. */
export function extensionCeiling(slot: Slot, slots: Slot[], now: number = Date.now()): string {
  const horizon = new Date(now + SLOT_HORIZON_MS).toISOString();
  const next = nextSlotStart(slot, slots);
  return next && Date.parse(next) < Date.parse(horizon) ? next : horizon;
}

export function slotIsRunning(slot: Slot, now: number = Date.now()): boolean {
  return isRunning(slot, new Date(now).toISOString());
}

export type Availability =
  | { state: "free" }
  | { state: "free_until"; at: string; by: PublicUser; slot: Slot }
  | { state: "busy_until"; at: string; by: PublicUser; slot: Slot }
  | { state: "invisible" };

/** Dock summary per printer for the loaded range, relative to `now`. */
export function printerAvailability(
  printer: Printer,
  slots: Slot[],
  now: number = Date.now(),
): Availability {
  if (printer.invisible) return { state: "invisible" };
  const mine = slots
    .filter((s) => s.printers.some((p) => p.id === printer.id))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const nowIso = new Date(now).toISOString();
  const running = mine.find((s) => isRunning(s, nowIso));
  if (running) return { state: "busy_until", at: running.end_at, by: running.user, slot: running };
  const next = mine.find((s) => Date.parse(s.start_at) > now);
  if (next) return { state: "free_until", at: next.start_at, by: next.user, slot: next };
  return { state: "free" };
}

/** The next `limit` slots that have not started yet, soonest first (the dock's Upcoming list). */
export function upcomingSlots(slots: Slot[], now: number = Date.now(), limit = 5): Slot[] {
  return slots
    .filter((s) => Date.parse(s.start_at) > now)
    .sort((a, b) => a.start_at.localeCompare(b.start_at) || a.id - b.id)
    .slice(0, limit);
}
