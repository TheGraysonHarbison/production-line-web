import type { Slot } from "@production-line/shared";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { type DragRange, Timeline } from "../components/Timeline.tsx";
import { ApiError } from "../lib/api.ts";
import { usePrinters, useSlotMutations, useSlotsRange } from "../lib/data.ts";
import { useEditor } from "../lib/editor.tsx";
import { useTimeZone } from "../lib/prefs.ts";
import { addDays, dayBounds, formatDate, todayPlainDate } from "../lib/time.ts";

const RESIZE_ERRORS: Record<string, string> = {
  conflict: "That would overlap another booking.",
  slot_running_start_locked: "A running slot's start can't move.",
  slot_beyond_horizon: "Slots can end at most 30 days from now.",
};

/** Day timeline (dev doc §11.2) with drag-to-create and drag-to-resize, plus the editor hooks. */
export function DayPage() {
  const { date = "" } = useParams();
  const tz = useTimeZone();
  const navigate = useNavigate();
  const editor = useEditor();
  const printers = usePrinters();
  const { update } = useSlotMutations();
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const bounds = valid ? dayBounds(date, tz) : null;
  const slots = useSlotsRange(
    bounds?.from ?? "1970-01-01T00:00:00.000Z",
    bounds?.to ?? "1970-01-02T00:00:00.000Z",
  );
  if (!valid || !bounds) return <p role="alert">Unknown day.</p>;

  const today = todayPlainDate(tz);
  const onCreate = (r: DragRange) =>
    editor.openCreate({ start_at: r.start_at, end_at: r.end_at, printer_ids: [r.printer.id] });
  const onResize = (slot: Slot, end_at: string) => {
    setNotice(null);
    update.mutate(
      { id: slot.id, end_at },
      {
        onError: (err) => {
          const code = err instanceof ApiError ? err.code : "error";
          setNotice(
            err instanceof ApiError
              ? (RESIZE_ERRORS[code] ?? err.message)
              : "Could not change the slot.",
          );
        },
      },
    );
  };
  const btn = "rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700";

  return (
    <main className="flex flex-col gap-4" data-testid="day">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-semibold text-2xl">{formatDate(date)}</h1>
        {date === today ? (
          <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs dark:bg-neutral-800">
            Today
          </span>
        ) : null}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={btn}
            onClick={() => navigate(`/day/${addDays(date, -1)}`)}
            aria-label="Previous day"
          >
            ‹
          </button>
          <Link to={`/?month=${date.slice(0, 7)}`} className={btn}>
            Month
          </Link>
          <button
            type="button"
            className={btn}
            onClick={() => navigate(`/day/${addDays(date, 1)}`)}
            aria-label="Next day"
          >
            ›
          </button>
        </div>
      </div>
      {notice ? (
        <p
          className="rounded-md bg-red-100 px-3 py-2 text-red-900 text-sm dark:bg-red-900 dark:text-red-100"
          role="alert"
        >
          {notice}
        </p>
      ) : null}
      {printers.data?.length === 0 ? (
        <p className="text-sm opacity-70">
          No printers yet. An admin can add some under Settings → Printers.
        </p>
      ) : null}
      {printers.data && printers.data.length > 0 ? (
        <Timeline
          date={date}
          bounds={bounds}
          printers={printers.data}
          slots={slots.data ?? []}
          now={now}
          onCreate={onCreate}
          onOpen={editor.openEdit}
          onResize={onResize}
        />
      ) : null}
      <p className="text-xs opacity-60">
        Drag on a lane to book, drag a card's right edge to change its end, or use the Book buttons
        and the editor for keyboard access.
      </p>
    </main>
  );
}
