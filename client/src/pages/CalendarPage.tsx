import type { Slot } from "@production-line/shared";
import { Link, useNavigate, useSearchParams } from "react-router";
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

/** Month view (dev doc §11.2): stacked color bars per user per day; a day opens the timeline. */
export function CalendarPage() {
  const tz = useTimeZone();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = todayPlainDate(tz);
  const yearMonth = params.get("month") ?? yearMonthOf(today);
  const grid = monthGrid(yearMonth, tz);
  const slots = useSlotsRange(grid.from, grid.to);

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
  const btn = "rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700";

  return (
    <main className="flex flex-col gap-4" data-testid="calendar">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-semibold text-2xl">{formatMonth(yearMonth)}</h1>
        <div className="ml-auto flex gap-2">
          <button type="button" className={btn} onClick={() => go(-1)} aria-label="Previous month">
            ‹
          </button>
          <button type="button" className={btn} onClick={() => setParams({})}>
            This month
          </button>
          <button type="button" className={btn} onClick={() => go(1)} aria-label="Next month">
            ›
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 dark:border-neutral-800 dark:bg-neutral-800">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="bg-white px-2 py-1 font-medium text-xs opacity-70 dark:bg-neutral-900"
          >
            {d}
          </div>
        ))}
        {grid.weeks.flat().map((day) => {
          const inMonth = yearMonthOf(day) === yearMonth;
          const users = byDay.get(day);
          return (
            <Link
              key={day}
              to={`/day/${day}`}
              className={`flex min-h-24 flex-col gap-1 bg-white p-1.5 hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-800 ${inMonth ? "" : "opacity-40"}`}
              data-testid="calendar-day"
              data-date={day}
              aria-label={`${day}${users ? `, ${[...users.values()].reduce((n, u) => n + u.count, 0)} slots` : ""}`}
            >
              <span
                className={`text-sm ${day === today ? "rounded-full bg-neutral-900 px-1.5 text-white dark:bg-white dark:text-neutral-900 w-fit" : ""}`}
              >
                {day.slice(-2).replace(/^0/, "")}
              </span>
              {users
                ? [...users.values()].map((u) => (
                    <span
                      key={u.username}
                      className="truncate rounded px-1 text-xs"
                      style={{
                        backgroundColor: `color-mix(in oklab, ${u.color} 35%, transparent)`,
                        borderLeft: `3px solid ${u.color}`,
                      }}
                      title={`${u.username}: ${u.count} slot${u.count > 1 ? "s" : ""}`}
                    >
                      {u.username}
                      {u.count > 1 ? ` ×${u.count}` : ""}
                    </span>
                  ))
                : null}
            </Link>
          );
        })}
      </div>
      <p className="text-sm opacity-70">
        Tip: pick a day to see the timeline, or{" "}
        <button type="button" className="underline" onClick={() => navigate(`/day/${today}`)}>
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
