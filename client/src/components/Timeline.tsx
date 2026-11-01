import type { Printer, Slot } from "@production-line/shared";
import { type PointerEvent as ReactPointerEvent, useCallback, useRef, useState } from "react";
import { useMe } from "../lib/auth.tsx";
import { useTimeFormat, useTimeZone } from "../lib/prefs.ts";
import { canEditSlot, slotIsRunning } from "../lib/slots.ts";
import {
  type DayBounds,
  dayTicks,
  formatTime,
  isoFromMs,
  minutesInto,
  snapMinutes,
  type Tick,
} from "../lib/time.ts";
import { SlotCard } from "./SlotCard.tsx";

export const PX_PER_MINUTE = 1.25;
const LANE_HEIGHT = 56;
const LABEL_WIDTH = 160;
const GUTTER_WIDTH = 56;
const COLUMN_HEADER = 48;
/** Narrowest a vertical column may get before the timeline scrolls sideways (≥ 44px targets). */
const MIN_COLUMN = 120;

export type Orientation = "horizontal" | "vertical";

export interface DragRange {
  printer: Printer;
  start_at: string;
  end_at: string;
}

interface TimelineProps {
  date: string;
  bounds: DayBounds;
  printers: Printer[];
  slots: Slot[];
  now: number;
  /** Horizontal lanes on desktop/tablet; vertical, scrolling columns on phones (dev doc §11.2). */
  orientation?: Orientation;
  onCreate: (range: DragRange) => void;
  onOpen: (slot: Slot) => void;
  /** A drag changed the slot's start and/or end (resize either edge, or move the whole slot). */
  onChange: (slot: Slot, patch: { start_at?: string; end_at?: string }) => void;
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
 * Day timeline (dev doc §11.2): one lane per printer, hour ticks, hatched past, current-time line,
 * drag-to-create on empty lane space, drag either edge of your own cards to change start/end, and
 * drag a card's body to move it (mouse/pen only: on touch a tap opens the editor instead, so the
 * page still scrolls). A tap without movement books an hour at that time; keyboard users create
 * via the per-lane "Book" button and change times through the editor.
 */
export function Timeline({
  date,
  bounds,
  printers,
  slots,
  now,
  orientation = "horizontal",
  onCreate,
  onOpen,
  onChange,
}: TimelineProps) {
  const vertical = orientation === "vertical";
  const tz = useTimeZone();
  const fmt = useTimeFormat();
  const me = useMe();
  const ticks: Tick[] = dayTicks(date, tz, fmt);
  const length = minuteToX(bounds.minutes);
  const nowMinute = minutesInto(isoFromMs(now), bounds.from);
  const nowInDay = nowMinute >= 0 && nowMinute <= bounds.minutes;
  const pastMinutes = Math.min(Math.max(nowMinute, 0), bounds.minutes);
  const [drag, setDrag] = useState<DragState | null>(null);
  const laneRefs = useRef(new Map<number, HTMLDivElement>());

  const minuteAt = useCallback(
    (printerId: number, clientX: number, clientY: number) => {
      const el = laneRefs.current.get(printerId);
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const px = vertical ? clientY - rect.top : clientX - rect.left;
      return Math.min(Math.max(xToMinute(px), 0), bounds.minutes);
    },
    [bounds.minutes, vertical],
  );

  const onLanePointerDown = (printer: Printer) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || printer.invisible || e.target !== e.currentTarget) return;
    const m = snapMinutes(minuteAt(printer.id, e.clientX, e.clientY), "floor");
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: "create", printer, anchor: m, current: m, moved: false });
  };

  const onHandlePointerDown =
    (printer: Printer, slot: Slot, edge: "start" | "end") =>
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const m = minutesInto(edge === "end" ? slot.end_at : slot.start_at, bounds.from);
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

  /** Where a slot sits right now, in minutes into the day, including any in-progress drag. */
  const displayRange = (slot: Slot): { start: number; end: number } => {
    let start = minutesInto(slot.start_at, bounds.from);
    let end = minutesInto(slot.end_at, bounds.from);
    if (drag?.slot?.id === slot.id) {
      if (drag.kind === "resize-end") end = Math.max(drag.current, start + 5);
      else if (drag.kind === "resize-start") start = Math.min(drag.current, end - 5);
      else if (drag.kind === "move") {
        // Keep the slot inside the day unless it already crossed midnight.
        let delta = drag.current - drag.anchor;
        if (start >= 0) delta = Math.max(delta, -start);
        if (end <= bounds.minutes) delta = Math.min(delta, bounds.minutes - end);
        start += delta;
        end += delta;
      }
    }
    return { start, end };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return;
    const m = snapMinutes(minuteAt(drag.printer.id, e.clientX, e.clientY));
    if (m !== drag.current) setDrag({ ...drag, current: m, moved: true });
  };

  const onPointerUp = () => {
    if (!drag) return;
    setDrag(null);
    if (drag.kind === "create") {
      let start = Math.min(drag.anchor, drag.current);
      let end = Math.max(drag.anchor, drag.current);
      if (!drag.moved || end - start < 5) {
        start = drag.anchor;
        end = Math.min(drag.anchor + 60, bounds.minutes);
      }
      onCreate({
        printer: drag.printer,
        start_at: isoFromMs(Date.parse(bounds.from) + start * 60_000),
        end_at: isoFromMs(Date.parse(bounds.from) + end * 60_000),
      });
    } else if (drag.slot && !drag.moved) {
      // A click (no movement) on a card opens it.
      if (drag.kind === "move") onOpen(drag.slot);
    } else if (drag.slot) {
      const { start, end } = displayRange(drag.slot);
      const iso = (m: number) => isoFromMs(Date.parse(bounds.from) + m * 60_000);
      if (drag.kind === "resize-end") onChange(drag.slot, { end_at: iso(end) });
      else if (drag.kind === "resize-start") onChange(drag.slot, { start_at: iso(start) });
      else onChange(drag.slot, { start_at: iso(start), end_at: iso(end) });
    }
  };

  const book = (printer: Printer) => {
    const start = snapMinutes(Math.max(nowInDay ? nowMinute : 0, 0), "ceil");
    onCreate({
      printer,
      start_at: isoFromMs(Date.parse(bounds.from) + start * 60_000),
      end_at: isoFromMs(Date.parse(bounds.from) + Math.min(start + 60, bounds.minutes) * 60_000),
    });
  };

  // Geometry helpers: `along` is the time axis, `across` the other one.
  const along = (px: number) => (vertical ? { top: px } : { left: px });
  const span = (from: number, to: number) =>
    vertical ? { top: from, height: to - from } : { left: from, width: to - from };

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
        {/* hatched: the past, or the whole lane for invisible printers */}
        <div
          className="hatched pointer-events-none absolute opacity-70"
          style={{
            ...(vertical ? { insetInline: 0 } : { insetBlock: 0 }),
            ...span(0, printer.invisible ? length : minuteToX(pastMinutes)),
          }}
          aria-hidden="true"
        />
        {ticks.map((t) => (
          <div
            key={t.iso}
            className={`pointer-events-none absolute border-line ${
              vertical ? "inset-x-0 border-t" : "inset-y-0 border-l"
            }`}
            style={along(minuteToX(t.minute))}
            aria-hidden="true"
          />
        ))}
        {laneSlots.map((slot) => {
          const range = displayRange(slot);
          const start = Math.max(range.start, 0);
          const end = Math.min(range.end, bounds.minutes);
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
        {nowInDay ? (
          <div
            className={`pointer-events-none absolute bg-danger ${
              vertical ? "inset-x-0 h-0.5" : "inset-y-0 w-0.5"
            }`}
            style={along(minuteToX(nowMinute))}
            aria-hidden="true"
            data-testid="now-line"
            title={formatTime(isoFromMs(now), tz, fmt)}
          />
        ) : null}
      </div>
    );
  };

  if (vertical) {
    return (
      <div
        className="glass overflow-x-auto rounded-2xl"
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
            className="sticky top-0 z-[1] border-line border-b"
            style={{ height: COLUMN_HEADER }}
          />
          {printers.map((printer) => (
            <div
              key={printer.id}
              className="glass-strong sticky top-0 z-[1] flex flex-col justify-center border-line border-x-0 border-t-0 border-b text-center shadow-none"
              style={{ height: COLUMN_HEADER }}
              data-testid="lane"
              data-printer-id={printer.id}
            >
              <LaneLabel printer={printer} onBook={book} />
            </div>
          ))}
          {/* body row: tick gutter + one lane per printer */}
          <div className="relative border-line border-r" style={{ height: length }}>
            {ticks.map((t) => (
              <span
                key={t.iso}
                className="-translate-y-1/2 absolute right-1.5 text-ink-muted text-xs"
                style={{ top: minuteToX(t.minute) }}
                data-testid="tick"
              >
                {t.label}
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
      className="glass overflow-x-auto rounded-2xl"
      data-testid="timeline"
      data-orientation="horizontal"
    >
      <div style={{ width: length + LABEL_WIDTH }}>
        {/* ticks */}
        <div className="flex border-line border-b text-xs" style={{ height: 28 }}>
          <div className="shrink-0 border-line border-r" style={{ width: LABEL_WIDTH }} />
          <div className="relative" style={{ width: length }}>
            {ticks.map((t) => (
              <span
                key={t.iso}
                className="-translate-x-1/2 absolute top-1 text-ink-muted"
                style={{ left: minuteToX(t.minute) }}
                data-testid="tick"
              >
                {t.label}
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
              className="flex shrink-0 flex-col justify-center border-line border-r"
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
