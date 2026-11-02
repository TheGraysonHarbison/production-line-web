import { useEffect, useMemo, useState } from "react";
import { useSlotsRange } from "../lib/data.ts";
import { useEditor } from "../lib/editor.tsx";
import { useTimeFormat, useTimeZone } from "../lib/prefs.ts";
import { upcomingSlots } from "../lib/slots.ts";
import {
  addDays,
  dayBounds,
  formatDate,
  formatTime,
  plainDateOf,
  stripEnd,
  todayPlainDate,
} from "../lib/time.ts";

export const UPCOMING_LIMIT = 5;

/** "Today", "Tomorrow", or "Wed, Nov 5". */
function whenLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return formatDate(date, "short");
}

/** The next few bookings across every printer (dev doc §11.1); each opens in the editor. */
export function UpcomingList() {
  const tz = useTimeZone();
  const fmt = useTimeFormat();
  const editor = useEditor();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const today = todayPlainDate(tz, now);
  // From the start of today to the end of the booking horizon; keyed on the day so the query
  // (and its live updates) stays put while the clock ticks.
  const range = useMemo(
    () => ({ from: dayBounds(today, tz).from, to: stripEnd(tz, Date.now()) }),
    [today, tz],
  );
  const slots = useSlotsRange(range.from, range.to);
  const next = useMemo(
    () => upcomingSlots(slots.data ?? [], now, UPCOMING_LIMIT),
    [slots.data, now],
  );

  if (slots.isPending) return <p className="text-ink-muted text-sm">Loading…</p>;
  if (next.length === 0)
    return (
      <p className="text-ink-muted text-sm" data-testid="upcoming-empty">
        Nothing booked yet.
      </p>
    );

  return (
    <ol className="flex flex-col" data-testid="upcoming-slots">
      {next.map((s) => {
        const date = plainDateOf(s.start_at, tz);
        const printers = s.printers.map((p) => p.name).join(", ");
        return (
          <li key={s.id}>
            <button
              type="button"
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent-soft"
              onClick={() => editor.openEdit(s)}
              data-testid="upcoming-slot"
              title={`${s.name} · ${s.user.username} · ${printers}`}
            >
              <span
                aria-hidden="true"
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ background: s.user.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-ink-muted"> · {s.user.username}</span>
                </span>
                <span className="block truncate text-ink-muted text-xs">
                  {whenLabel(date, today)} {formatTime(s.start_at, tz, fmt)} · {printers}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
