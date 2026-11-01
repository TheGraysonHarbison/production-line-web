import type { Slot } from "@production-line/shared";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "../components/Icons.tsx";
import { useSlotsRange } from "../lib/data.ts";
import { useTimeZone } from "../lib/prefs.ts";
import {
  formatMonth,
  monthGrid,
  plainDateOf,
  shiftMonth,
  todayPlainDate,
  yearMonthOf,
} from "../lib/time.ts";
import { useViewport } from "../lib/viewport.ts";

const iconBtn =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line-strong bg-canvas/40 hover:bg-accent-soft";

/** Month view (dev doc §11.2): stacked color bars per user per day; a day opens the timeline. */
export function CalendarPage() {
  const tz = useTimeZone();
  const navigate = useNavigate();
  const viewport = useViewport();
  const [params, setParams] = useSearchParams();
  const today = todayPlainDate(tz);
  const yearMonth = params.get("month") ?? yearMonthOf(today);
  const grid = monthGrid(yearMonth, tz);
  const slots = useSlotsRange(grid.from, grid.to);
  const compact = viewport === "mobile";

  // Bucket slots by every calendar day they touch, then by user.
  const byDay = new Map<string, Map<number, { color: string; username: string; count: number }>>();
  for (const s of slots.data ?? []) {
    for (const day of daysTouched(s, tz)) {
      const users = byDay.get(day) ?? new Map();
      const entry = users.get(s.user.id) ?? {
        color: s.user.color,
        username: s.user.username,
        count: 0,
      };
      entry.count++;
      users.set(s.user.id, entry);
      byDay.set(day, users);
    }
  }

  const go = (months: number) => setParams({ month: shiftMonth(yearMonth, months) });

  return (
    <main className="flex flex-col gap-4" data-testid="calendar">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-semibold text-2xl">{formatMonth(yearMonth)}</h1>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={iconBtn}
            onClick={() => go(-1)}
            aria-label="Previous month"
          >
            <ChevronLeftIcon />
          </button>
          <button type="button" className={`${iconBtn} px-3 text-sm`} onClick={() => setParams({})}>
            This month
          </button>
          <button type="button" className={iconBtn} onClick={() => go(1)} aria-label="Next month">
            <ChevronRightIcon />
          </button>
        </div>
      </div>
      <div className="glass overflow-hidden rounded-2xl">
        <div className="grid grid-cols-7 gap-px bg-line">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div
              key={d}
              className="bg-canvas/50 px-2 py-1.5 text-center font-medium text-ink-muted text-xs"
            >
              {compact ? d.charAt(0) : d}
            </div>
          ))}
          {grid.weeks.flat().map((day) => {
            const inMonth = yearMonthOf(day) === yearMonth;
            const users = byDay.get(day);
            const total = users ? [...users.values()].reduce((n, u) => n + u.count, 0) : 0;
            return (
              <Link
                key={day}
                to={`/day/${day}`}
                className={`flex flex-col items-stretch gap-1 bg-canvas/30 p-1.5 transition-colors hover:bg-accent-soft ${
                  compact ? "min-h-16" : "min-h-24"
                } ${inMonth ? "" : "opacity-40"}`}
                data-testid="calendar-day"
                data-date={day}
                aria-label={`${day}${users ? `, ${total} slots` : ""}`}
              >
                <span
                  className={`w-fit text-sm ${
                    day === today ? "rounded-full bg-accent px-1.5 font-medium text-on-accent" : ""
                  }`}
                >
                  {day.slice(-2).replace(/^0/, "")}
                </span>
                {users
                  ? [...users.values()].map((u) => (
                      <span
                        key={u.username}
                        className={`truncate rounded text-xs ${compact ? "h-1.5" : "px-1"}`}
                        style={{
                          backgroundColor: compact
                            ? u.color
                            : `color-mix(in oklab, ${u.color} 35%, transparent)`,
                          borderLeft: compact ? undefined : `3px solid ${u.color}`,
                        }}
                        title={`${u.username}: ${u.count} slot${u.count > 1 ? "s" : ""}`}
                      >
                        {compact ? null : (
                          <>
                            {u.username}
                            {u.count > 1 ? ` ×${u.count}` : ""}
                          </>
                        )}
                      </span>
                    ))
                  : null}
              </Link>
            );
          })}
        </div>
      </div>
      <p className="text-ink-muted text-sm">
        Pick a day to see the timeline, or{" "}
        <button
          type="button"
          className="inline-flex min-h-11 items-center text-accent underline underline-offset-2 lg:min-h-0"
          onClick={() => navigate(`/day/${today}`)}
        >
          jump to today
        </button>
        .
      </p>
    </main>
  );
}

function daysTouched(slot: Slot, tz: string): string[] {
  const first = plainDateOf(slot.start_at, tz);
  const lastInstant = Date.parse(slot.end_at) - 1;
  const last = plainDateOf(new Date(lastInstant).toISOString(), tz);
  if (first === last) return [first];
  const days = [first];
  let cursor = first;
  while (cursor !== last && days.length < 62) {
    const next = new Date(
      Date.UTC(
        Number(cursor.slice(0, 4)),
        Number(cursor.slice(5, 7)) - 1,
        Number(cursor.slice(8, 10)) + 1,
      ),
    )
      .toISOString()
      .slice(0, 10);
    days.push(next);
    cursor = next;
  }
  return days;
}
