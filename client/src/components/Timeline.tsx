import type { Printer, Slot } from "@production-line/shared";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMe } from "../lib/auth.tsx";
import { useTimeFormat, useTimeZone } from "../lib/prefs.ts";
import { canEditSlot, slotIsRunning } from "../lib/slots.ts";
import {
  type DayBounds,
  dayBounds,
  formatDayParts,
  formatTime,
  isoFromMs,
  minutesInto,
  rangeDays,
  rangeTicks,
  snapMinutes,
  type Tick,
} from "../lib/time.ts";
import { SlotCard } from "./SlotCard.tsx";

export const PX_PER_MINUTE = 1.25;
const HOUR_PX = 60 * PX_PER_MINUTE;
const LANE_HEIGHT = 56;
const LABEL_WIDTH = 160;
const GUTTER_WIDTH = 56;
const COLUMN_HEADER = 48;
/** Narrowest a vertical column may get before the timeline scrolls sideways (≥ 44px targets). */
const MIN_COLUMN = 120;
/** How far before the target a jump lands, so the thing you asked for isn't flush with the edge. */
const JUMP_LEAD_MINUTES = 30;

export type Orientation = "horizontal" | "vertical";

export interface DragRange {
  printer: Printer;
  start_at: string;
  end_at: string;
}

/** A request to scroll the strip: to a calendar date's first minute, or to the current time. */
export interface Jump {
  to: "now" | string;
  /** Bumped for every new request so repeating the same target still scrolls. */
  seq: number;
  smooth: boolean;
}

interface TimelineProps {
  /** The visible strip: from a little before now (or an earlier requested day) to the horizon. */
  strip: DayBounds;
  /** Latest instant a slot may end (now + 30 days), as epoch ms. */
  horizon: number;
  printers: Printer[];
  slots: Slot[];
  now: number;
  /** Horizontal lanes on desktop/tablet; vertical, scrolling columns on phones (dev doc §11.2). */
  orientation?: Orientation;
  jump: Jump;
  onCreate: (range: DragRange) => void;
  onOpen: (slot: Slot) => void;
  /** A drag changed the slot's start and/or end (resize either edge, or move the whole slot). */
  onChange: (slot: Slot, patch: { start_at?: string; end_at?: string }) => void;
  /** The calendar date at the leading edge of the scrolled view changed. */
  onViewDate?: (date: string) => void;
}

export function minuteToX(minute: number): number {
  return minute * PX_PER_MINUTE;
}
export function xToMinute(x: number): number {
  return x / PX_PER_MINUTE;
}

interface DragState {
  kind: "create" | "resize-end" | "resize-start" | "move";
  printer: Printer;
  slot?: Slot;
  anchor: number;
  current: number;
  moved: boolean;
}

/**
 * The timeline strip (dev doc §11.2): one lane per printer running from shortly before now to the
 * 30-day booking horizon, scrolling across days. Hour ticks, date markers at midnight, hatched
 * past and beyond-horizon, current-time line, drag-to-create on empty lane space, drag either edge
 * of your own cards to change start/end, and drag a card's body to move it (mouse/pen only: on
 * touch a tap opens the editor instead, so the page still scrolls). Every drag is clamped to the
 * bookable window, so nothing lands in the past or past the horizon. A tap without movement books
 * an hour at that time; keyboard users create via the per-lane "Book" button.
 */
export function Timeline({
  strip,
  horizon,
  printers,
  slots,
  now,
  orientation = "horizontal",
  jump,
  onCreate,
  onOpen,
  onChange,
  onViewDate,
}: TimelineProps) {
  const vertical = orientation === "vertical";
  const tz = useTimeZone();
  const fmt = useTimeFormat();
  const me = useMe();
  const ticks: Tick[] = rangeTicks(strip.from, strip.to, tz, fmt);
  const days = rangeDays(strip.from, strip.to, tz);
  const length = minuteToX(strip.minutes);
  const nowMinute = Math.min(Math.max(minutesInto(isoFromMs(now), strip.from), 0), strip.minutes);
  const horizonMinute = Math.min(minutesInto(isoFromMs(horizon), strip.from), strip.minutes);
  // The bookable window: the first 5-minute mark not yet past, through the horizon.
  const liveLo = snapMinutes(nowMinute, "ceil");
  const liveHi = snapMinutes(horizonMinute, "floor");
  const [drag, setDrag] = useState<DragState | null>(null);
  const laneRefs = useRef(new Map<number, HTMLDivElement>());
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Scroll requests from the page (initial day, Previous/Next day, Now).
  const handledJump = useRef(-1);
  useEffect(() => {
    if (handledJump.current === jump.seq) return;
    handledJump.current = jump.seq;
    const el = scrollerRef.current;
    if (!el) return;
    const minute =
      jump.to === "now"
        ? nowMinute - JUMP_LEAD_MINUTES
        : minutesInto(dayBounds(jump.to, tz).from, strip.from);
    const px = minuteToX(Math.max(minute, 0));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({
      ...(vertical ? { top: px } : { left: px }),
      behavior: jump.smooth && !reduce ? "smooth" : "instant",
    });
  }, [jump, nowMinute, strip.from, tz, vertical]);

  // Report the day at the leading edge as the user scrolls.
  const lastViewDate = useRef("");
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || !onViewDate) return;
    const minute = xToMinute(vertical ? el.scrollTop : el.scrollLeft) + 1;
    let date = days[0]?.date ?? "";
    for (const d of days) if (d.minute <= minute) date = d.date;
    if (date !== lastViewDate.current) {
      lastViewDate.current = date;
      onViewDate(date);
    }
  };

  // Phones: the strip scrolls inside the page, so size it to fill down to the tab bar.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!vertical || !el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const tabbar = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--tabbar-height"),
      );
      const bottomInset = (Number.isFinite(tabbar) ? tabbar : 0) + 16;
      el.style.height = `${Math.max(240, window.innerHeight - top - bottomInset)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [vertical]);

  const minuteAt = useCallback(
    (printerId: number, clientX: number, clientY: number) => {
      const el = laneRefs.current.get(printerId);
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const px = vertical ? clientY - rect.top : clientX - rect.left;
      return Math.min(Math.max(xToMinute(px), 0), strip.minutes);
    },
    [strip.minutes, vertical],
  );

  /** Clamps a pointer position to what the drag may legally produce (dev doc §3.3). */
  const clampFor = (d: DragState, m: number): number => {
    const s = d.slot ? minutesInto(d.slot.start_at, strip.from) : 0;
    const e = d.slot ? minutesInto(d.slot.end_at, strip.from) : 0;
    switch (d.kind) {
      case "create":
        return Math.min(Math.max(m, liveLo), liveHi);
      case "resize-start":
        return Math.min(Math.max(m, liveLo), e - 5);
      case "resize-end":
        return Math.min(Math.max(m, s + 5, liveLo), liveHi);
      case "move": {
        const delta = Math.min(Math.max(m - d.anchor, liveLo - s), liveHi - e);
        return d.anchor + delta;
      }
    }
  };

  const onLanePointerDown = (printer: Printer) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || printer.invisible || e.target !== e.currentTarget) return;
    const raw = minuteAt(printer.id, e.clientX, e.clientY);
    // The hatched past and beyond-horizon areas aren't bookable; a press there does nothing.
    if (raw < nowMinute || raw > horizonMinute) return;
    const m = Math.max(snapMinutes(raw, "floor"), liveLo);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: "create", printer, anchor: m, current: m, moved: false });
  };

  const onHandlePointerDown =
    (printer: Printer, slot: Slot, edge: "start" | "end") =>
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const m = minutesInto(edge === "end" ? slot.end_at : slot.start_at, strip.from);
      setDrag({
        kind: edge === "end" ? "resize-end" : "resize-start",
        printer,
        slot,
        anchor: m,
        current: m,
        moved: false,
      });
    };

  const onCardPointerDown =
    (printer: Printer, slot: Slot) => (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const m = snapMinutes(minuteAt(printer.id, e.clientX, e.clientY));
      setDrag({ kind: "move", printer, slot, anchor: m, current: m, moved: false });
    };

  /** Where a slot sits right now, in minutes into the strip, including any in-progress drag. */
  const displayRange = (slot: Slot): { start: number; end: number } => {
    let start = minutesInto(slot.start_at, strip.from);
    let end = minutesInto(slot.end_at, strip.from);
    if (drag?.slot?.id === slot.id) {
      if (drag.kind === "resize-end") end = Math.max(drag.current, start + 5);
      else if (drag.kind === "resize-start") start = Math.min(drag.current, end - 5);
      else if (drag.kind === "move") {
        const delta = drag.current - drag.anchor;
        start += delta;
        end += delta;
      }
    }
    return { start, end };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return;
    const m = clampFor(drag, snapMinutes(minuteAt(drag.printer.id, e.clientX, e.clientY)));
    if (m !== drag.current) setDrag({ ...drag, current: m, moved: true });
  };

  const onPointerUp = () => {
    if (!drag) return;
    setDrag(null);
    const iso = (m: number) => isoFromMs(Date.parse(strip.from) + m * 60_000);
    if (drag.kind === "create") {
      let start = Math.min(drag.anchor, drag.current);
      let end = Math.max(drag.anchor, drag.current);
      if (!drag.moved || end - start < 5) {
        start = drag.anchor;
        end = Math.min(drag.anchor + 60, liveHi);
      }
      if (end - start < 5) return;
      onCreate({ printer: drag.printer, start_at: iso(start), end_at: iso(end) });
    } else if (drag.slot && !drag.moved) {
      // A click (no movement) on a card opens it.
      if (drag.kind === "move") onOpen(drag.slot);
    } else if (drag.slot) {
      const { start, end } = displayRange(drag.slot);
      if (drag.kind === "resize-end") onChange(drag.slot, { end_at: iso(end) });
      else if (drag.kind === "resize-start") onChange(drag.slot, { start_at: iso(start) });
      else onChange(drag.slot, { start_at: iso(start), end_at: iso(end) });
    }
  };

  /** "Book" on a lane label books an hour at the leading edge of what you're looking at. */
  const book = (printer: Printer) => {
    const el = scrollerRef.current;
    const viewMinute = el ? xToMinute(vertical ? el.scrollTop : el.scrollLeft) : 0;
    const start = Math.min(Math.max(snapMinutes(viewMinute, "ceil"), liveLo), liveHi - 5);
    onCreate({
      printer,
      start_at: isoFromMs(Date.parse(strip.from) + start * 60_000),
      end_at: isoFromMs(Date.parse(strip.from) + Math.min(start + 60, liveHi) * 60_000),
    });
  };

  // Geometry helpers: `along` is the time axis, `across` the other one.
  const along = (px: number) => (vertical ? { top: px } : { left: px });
  const span = (from: number, to: number) =>
    vertical ? { top: from, height: to - from } : { left: from, width: to - from };
  const hatch = (from: number, to: number, key: string) =>
    to > from ? (
      <div
        key={key}
        className="hatched pointer-events-none absolute opacity-70"
        style={{ ...(vertical ? { insetInline: 0 } : { insetBlock: 0 }), ...span(from, to) }}
        aria-hidden="true"
        data-testid={`hatch-${key}`}
      />
    ) : null;

  const renderLaneBody = (printer: Printer) => {
    const laneSlots = slots.filter((s) => s.printers.some((p) => p.id === printer.id));
    const preview =
      drag && drag.printer.id === printer.id && drag.kind === "create"
        ? { start: Math.min(drag.anchor, drag.current), end: Math.max(drag.anchor, drag.current) }
        : null;
    return (
      <div
        ref={(el) => {
          if (el) laneRefs.current.set(printer.id, el);
          else laneRefs.current.delete(printer.id);
        }}
        className={`relative ${printer.invisible ? "" : "cursor-crosshair"}`}
        style={{
          ...(vertical ? { height: length } : { width: length }),
          // Hour lines as one gradient: the strip starts on an hour and hours are 60 real minutes
          // even on DST days, so a repeating pattern is exact and costs no DOM.
          backgroundImage: `repeating-linear-gradient(${
            vertical ? "to bottom" : "to right"
          }, var(--line) 0 1px, transparent 1px ${HOUR_PX}px)`,
          // Phones scroll the vertical timeline by touch; a plain tap still books. Mouse drags
          // work in both orientations.
          touchAction: vertical ? "pan-y" : "none",
        }}
        onPointerDown={onLanePointerDown(printer)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        data-testid="lane-track"
      >
        {/* hatched: the past and beyond the horizon, or the whole lane for invisible printers */}
        {printer.invisible
          ? hatch(0, length, "all")
          : [
              hatch(0, minuteToX(nowMinute), "past"),
              hatch(minuteToX(horizonMinute), length, "horizon"),
            ]}
        {days.slice(1).map((d) => (
          <div
            key={d.date}
            className={`pointer-events-none absolute border-line-strong ${
              vertical ? "inset-x-0 border-t" : "inset-y-0 border-l"
            }`}
            style={along(minuteToX(d.minute))}
            aria-hidden="true"
          />
        ))}
        {laneSlots.map((slot) => {
          const range = displayRange(slot);
          const start = Math.max(range.start, 0);
          const end = Math.min(range.end, strip.minutes);
          const editable = canEditSlot(me.data, slot);
          const running = slotIsRunning(slot, now);
          // A running slot's start is locked (dev doc §3.3), so it can neither move nor grow left.
          const movable = editable && !running;
          const startPx = minuteToX(start);
          const endPx = minuteToX(end);
          const handleClass = `absolute opacity-0 hover:opacity-100 focus:opacity-100 ${
            vertical ? "inset-x-1 h-2 cursor-ns-resize" : "inset-y-1 w-2 cursor-ew-resize"
          }`;
          const handleEvents = {
            onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              onPointerMove(e);
            },
            onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              onPointerUp();
            },
          };
          return (
            <div key={slot.id} className="contents">
              <SlotCard
                slot={slot}
                editable={editable}
                running={running}
                movable={movable}
                onOpen={onOpen}
                offset={startPx}
                length={endPx - startPx}
                vertical={vertical}
                onPointerDown={movable ? onCardPointerDown(printer, slot) : undefined}
                onPointerMove={movable ? handleEvents.onPointerMove : undefined}
                onPointerUp={movable ? handleEvents.onPointerUp : undefined}
                dragging={drag?.kind === "move" && drag.slot?.id === slot.id && drag.moved}
              />
              {movable ? (
                <button
                  type="button"
                  className={`${handleClass} ${vertical ? "rounded-t-md" : "rounded-l-md"}`}
                  style={{
                    ...along(startPx),
                    backgroundColor: slot.user.color,
                    touchAction: "none",
                  }}
                  onPointerDown={onHandlePointerDown(printer, slot, "start")}
                  {...handleEvents}
                  aria-label={`Drag to change the start of ${slot.name}`}
                  title="Drag to change the start time"
                  data-testid="resize-start-handle"
                  data-geometry="time"
                />
              ) : null}
              {editable ? (
                <button
                  type="button"
                  className={`${handleClass} ${vertical ? "rounded-b-md" : "rounded-r-md"}`}
                  style={{
                    ...along(endPx - 8),
                    backgroundColor: slot.user.color,
                    touchAction: "none",
                  }}
                  onPointerDown={onHandlePointerDown(printer, slot, "end")}
                  {...handleEvents}
                  aria-label={`Drag to change the end of ${slot.name}`}
                  title="Drag to change the end time"
                  data-testid="resize-handle"
                  data-geometry="time"
                />
              ) : null}
            </div>
          );
        })}
        {preview ? (
          <div
            className={`pointer-events-none absolute rounded-lg border-2 border-accent border-dashed bg-accent-soft/60 ${
              vertical ? "inset-x-1" : "inset-y-1"
            }`}
            style={{
              ...span(minuteToX(preview.start), minuteToX(preview.end)),
              ...(vertical
                ? { height: Math.max(minuteToX(preview.end - preview.start), 2) }
                : { width: Math.max(minuteToX(preview.end - preview.start), 2) }),
            }}
            aria-hidden="true"
          />
        ) : null}
        <div
          className={`pointer-events-none absolute bg-danger ${
            vertical ? "inset-x-0 h-0.5" : "inset-y-0 w-0.5"
          }`}
          style={along(minuteToX(nowMinute))}
          aria-hidden="true"
          data-testid="now-line"
          title={formatTime(isoFromMs(now), tz, fmt)}
        />
      </div>
    );
  };

  /** A tick label; at midnight it becomes the date marker instead of "12 AM". */
  const tickLabel = (t: Tick) => {
    if (!t.dayStart) return t.label;
    const parts = formatDayParts(t.date);
    return vertical ? (
      <>
        <span className="block">{parts.weekday}</span>
        <span className="block">{parts.day}</span>
      </>
    ) : (
      `${parts.weekday} ${parts.day}`
    );
  };

  if (vertical) {
    return (
      <div
        ref={scrollerRef}
        className="glass overflow-auto overscroll-contain rounded-2xl"
        onScroll={onScroll}
        data-testid="timeline"
        data-orientation="vertical"
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `${GUTTER_WIDTH}px repeat(${printers.length}, minmax(${MIN_COLUMN}px, 1fr))`,
            minWidth: GUTTER_WIDTH + printers.length * MIN_COLUMN,
          }}
        >
          {/* header row: corner + one column per printer */}
          <div
            className="glass-strong bg-(--glass-solid) sticky top-0 left-0 z-[2] border-line border-x-0 border-t-0 border-b shadow-none"
            style={{ height: COLUMN_HEADER }}
          />
          {printers.map((printer) => (
            <div
              key={printer.id}
              className="glass-strong bg-(--glass-solid) sticky top-0 z-[1] flex flex-col justify-center border-line border-x-0 border-t-0 border-b text-center shadow-none"
              style={{ height: COLUMN_HEADER }}
              data-testid="lane"
              data-printer-id={printer.id}
            >
              <LaneLabel printer={printer} onBook={book} />
            </div>
          ))}
          {/* body row: tick gutter + one lane per printer */}
          <div
            className="glass-strong bg-(--glass-solid) sticky left-0 z-[1] border-line border-y-0 border-l-0 border-r shadow-none"
            style={{ height: length }}
          >
            {ticks.map((t) => (
              <span
                key={t.iso}
                className={`absolute right-1.5 text-xs ${
                  t.dayStart
                    ? "left-1 text-right font-medium text-ink leading-tight"
                    : "-translate-y-1/2 text-ink-muted"
                }`}
                style={{ top: minuteToX(t.minute) + (t.dayStart ? 2 : 0) }}
                data-testid="tick"
                data-date={t.date}
                data-day-start={t.dayStart ? "true" : undefined}
              >
                {tickLabel(t)}
              </span>
            ))}
          </div>
          {printers.map((printer) => (
            <div
              key={printer.id}
              className="border-line border-r last:border-r-0"
              data-testid="lane-body"
              data-printer-id={printer.id}
            >
              {renderLaneBody(printer)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="glass overflow-x-auto overscroll-x-contain rounded-2xl"
      onScroll={onScroll}
      data-testid="timeline"
      data-orientation="horizontal"
    >
      <div style={{ width: length + LABEL_WIDTH }}>
        {/* ticks */}
        <div className="flex border-line border-b text-xs" style={{ height: 28 }}>
          <div
            className="glass-strong bg-(--glass-solid) sticky left-0 z-[2] shrink-0 border-line border-y-0 border-l-0 border-r shadow-none"
            style={{ width: LABEL_WIDTH }}
          />
          <div className="relative" style={{ width: length }}>
            {ticks.map((t, i) => (
              <span
                key={t.iso}
                className={`absolute top-1 whitespace-nowrap ${
                  t.dayStart ? "font-medium text-ink" : "-translate-x-1/2 text-ink-muted"
                } ${ticks[i - 1]?.dayStart ? "invisible" : ""}`}
                style={{ left: minuteToX(t.minute) + (t.dayStart ? 4 : 0) }}
                data-testid="tick"
                data-date={t.date}
                data-day-start={t.dayStart ? "true" : undefined}
              >
                {tickLabel(t)}
              </span>
            ))}
          </div>
        </div>

        {printers.map((printer) => (
          <div
            key={printer.id}
            className="flex border-line border-b last:border-b-0"
            style={{ height: LANE_HEIGHT }}
            data-testid="lane"
            data-printer-id={printer.id}
          >
            <div
              className="glass-strong bg-(--glass-solid) sticky left-0 z-[2] flex shrink-0 flex-col justify-center border-line border-y-0 border-l-0 border-r shadow-none"
              style={{ width: LABEL_WIDTH }}
            >
              <LaneLabel printer={printer} onBook={book} />
            </div>
            {renderLaneBody(printer)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The printer name cell. For bookable printers the whole cell is the keyboard/touch "Book" control
 * (it fills the lane, so it clears the 44px target on every layout).
 */
function LaneLabel({ printer, onBook }: { printer: Printer; onBook: (p: Printer) => void }) {
  if (printer.invisible) {
    return (
      <div className="flex h-full flex-col justify-center px-3 opacity-60">
        <span className="truncate font-medium text-sm">{printer.name}</span>
        <span className="text-ink-muted text-xs">not bookable</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="flex h-full w-full min-w-0 flex-col justify-center rounded-none px-3 text-left hover:bg-accent-soft"
      onClick={() => onBook(printer)}
      aria-label={`Book ${printer.name}`}
      title={`Book ${printer.name}`}
    >
      <span className="w-full truncate font-medium text-sm">{printer.name}</span>
      <span className="text-accent text-xs">+ Book</span>
    </button>
  );
}
