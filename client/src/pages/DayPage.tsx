import { SLOT_HORIZON_MS, type Slot } from "@production-line/shared";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "../components/Icons.tsx";
import { errorNoticeClass } from "../components/Notice.tsx";
import { type DragRange, type Jump, Timeline } from "../components/Timeline.tsx";
import { ApiError } from "../lib/api.ts";
import { usePrinters, useSlotMutations, useSlotsRange } from "../lib/data.ts";
import { useEditor } from "../lib/editor.tsx";
import { useTimeZone } from "../lib/prefs.ts";
import {
  addDays,
  formatDate,
  rangeBounds,
  stripEnd,
  stripOrigin,
  todayPlainDate,
} from "../lib/time.ts";
import { useViewport } from "../lib/viewport.ts";

const DRAG_ERRORS: Record<string, string> = {
  conflict: "That would overlap another booking.",
  slot_in_past: "A slot can't be moved into the past.",
  slot_running_start_locked: "A running slot's start can't move.",
  slot_beyond_horizon: "Slots can end at most 30 days from now.",
};

const iconBtn =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line-strong bg-canvas/40 hover:bg-accent-soft";

/**
 * The timeline page (dev doc §11.2). `/day/:date` is where the strip starts out scrolled; the
 * strip itself runs from shortly before now (or that day, if earlier) to the booking horizon.
 */
export function DayPage() {
  const { date = "" } = useParams();
  const tz = useTimeZone();
  const navigate = useNavigate();
  const editor = useEditor();
  const printers = usePrinters();
  const viewport = useViewport();
  const { update } = useSlotMutations();
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [jump, setJump] = useState<Jump>({ to: date, seq: 0, smooth: false });
  const [viewed, setViewed] = useState<{ for: string; date: string } | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const today = todayPlainDate(tz, now);
  // Fixed per requested day so the strip doesn't creep while you look at it; `today` is in the
  // list purely so a tab left open past midnight extends the strip by a day.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  const strip = useMemo(
    () =>
      valid
        ? rangeBounds(stripOrigin(date, tz, Date.now()), stripEnd(tz, Date.now()))
        : rangeBounds("1970-01-01T00:00:00.000Z", "1970-01-02T00:00:00.000Z"),
    [date, tz, valid, today],
  );
  const slots = useSlotsRange(strip.from, strip.to);

  // The URL changed (calendar, dock "Today", browser navigation): scroll to that day.
  useEffect(() => {
    setJump((j) => (j.to === date ? j : { to: date, seq: j.seq + 1, smooth: false }));
  }, [date]);

  if (!valid) return <p role="alert">Unknown day.</p>;

  const viewDate = viewed?.for === date ? viewed.date : date;
  const go = (target: string) => {
    setJump((j) => ({ to: target, seq: j.seq + 1, smooth: true }));
    if (target !== "now" && target !== date) navigate(`/day/${target}`, { replace: true });
  };
  const onCreate = (r: DragRange) =>
    editor.openCreate({ start_at: r.start_at, end_at: r.end_at, printer_ids: [r.printer.id] });
  const onChange = (slot: Slot, patch: { start_at?: string; end_at?: string }) => {
    setNotice(null);
    update.mutate(
      { id: slot.id, ...patch },
      {
        onError: (err) => {
          const code = err instanceof ApiError ? err.code : "error";
          setNotice(
            err instanceof ApiError
              ? (DRAG_ERRORS[code] ?? err.message)
              : "Could not change the slot.",
          );
        },
      },
    );
  };
  const vertical = viewport === "mobile";
  const hint = vertical
    ? "Scroll through the next 30 days. Tap a free spot to book an hour there, or tap a printer's name. Open a slot to change its times."
    : "Scroll sideways through the next 30 days. Drag on a lane to book, drag a card to move it, drag either edge to change its start or end, or use the Book buttons and the editor for keyboard access.";

  return (
    <main className="flex flex-col gap-4" data-testid="day">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-semibold text-2xl" data-testid="day-heading">
          {formatDate(viewDate, vertical ? "short" : "long")}
        </h1>
        {viewDate === today ? (
          <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-on-accent text-xs">
            Today
          </span>
        ) : null}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={iconBtn}
            onClick={() => go(addDays(viewDate, -1))}
            aria-label="Previous day"
          >
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            className={`${iconBtn} px-3 text-sm`}
            onClick={() => go("now")}
            aria-label="Jump to now"
            data-testid="jump-now"
          >
            Now
          </button>
          <Link to={`/?month=${viewDate.slice(0, 7)}`} className={`${iconBtn} px-3 text-sm`}>
            Month
          </Link>
          <button
            type="button"
            className={iconBtn}
            onClick={() => go(addDays(viewDate, 1))}
            aria-label="Next day"
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>
      {notice ? (
        <p className={errorNoticeClass} role="alert">
          {notice}
        </p>
      ) : null}
      {printers.data?.length === 0 ? (
        <p className="text-ink-muted text-sm">
          No printers yet. An admin can add some under Settings → Printers.
        </p>
      ) : null}
      {vertical ? <p className="text-ink-muted text-xs">{hint}</p> : null}
      {printers.data && printers.data.length > 0 ? (
        <Timeline
          strip={strip}
          horizon={now + SLOT_HORIZON_MS}
          printers={printers.data}
          slots={slots.data ?? []}
          now={now}
          orientation={vertical ? "vertical" : "horizontal"}
          jump={jump}
          onCreate={onCreate}
          onOpen={editor.openEdit}
          onChange={onChange}
          onViewDate={(d) => setViewed({ for: date, date: d })}
        />
      ) : null}
      {vertical ? null : <p className="text-ink-muted text-xs">{hint}</p>}
    </main>
  );
}
