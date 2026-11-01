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
  onCreate: (range: DragRange) => void;
  onOpen: (slot: Slot) => void;
  onResize: (slot: Slot, end_at: string) => void;
}

export function minuteToX(minute: number): number {
  return minute * PX_PER_MINUTE;
}
export function xToMinute(x: number): number {
  return x / PX_PER_MINUTE;
}

interface DragState {
  kind: "create" | "resize";
  printer: Printer;
  slot?: Slot;
  anchor: number;
  current: number;
  moved: boolean;
}

/**
 * Horizontal day timeline (dev doc §11.2): one lane per printer, hour ticks, hatched past,
 * current-time line, drag-to-create on empty lane space, drag-to-resize on your own cards.
 * Keyboard users create via the per-lane "Book" button and resize through the editor.
 */
export function Timeline({
  date,
  bounds,
  printers,
  slots,
  now,
  onCreate,
  onOpen,
  onResize,
}: TimelineProps) {
  const tz = useTimeZone();
  const fmt = useTimeFormat();
  const me = useMe();
  const ticks: Tick[] = dayTicks(date, tz, fmt);
  const width = minuteToX(bounds.minutes);
  const nowMinute = minutesInto(isoFromMs(now), bounds.from);
  const nowInDay = nowMinute >= 0 && nowMinute <= bounds.minutes;
  const pastMinutes = Math.min(Math.max(nowMinute, 0), bounds.minutes);
  const [drag, setDrag] = useState<DragState | null>(null);
  const laneRefs = useRef(new Map<number, HTMLDivElement>());

  const minuteAt = useCallback(
    (printerId: number, clientX: number) => {
      const el = laneRefs.current.get(printerId);
      if (!el) return 0;
      const x = clientX - el.getBoundingClientRect().left;
      return Math.min(Math.max(xToMinute(x), 0), bounds.minutes);
    },
    [bounds.minutes],
  );

  const onLanePointerDown = (printer: Printer) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || printer.invisible || e.target !== e.currentTarget) return;
    const m = snapMinutes(minuteAt(printer.id, e.clientX), "floor");
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: "create", printer, anchor: m, current: m, moved: false });
  };

  const onHandlePointerDown =
    (printer: Printer, slot: Slot) => (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const m = minutesInto(slot.end_at, bounds.from);
      setDrag({ kind: "resize", printer, slot, anchor: m, current: m, moved: false });
    };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return;
    const m = snapMinutes(minuteAt(drag.printer.id, e.clientX));
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
    } else if (drag.slot && drag.moved) {
      const startMinute = minutesInto(drag.slot.start_at, bounds.from);
      const end = Math.max(drag.current, startMinute + 5);
      onResize(drag.slot, isoFromMs(Date.parse(bounds.from) + end * 60_000));
    }
  };

  const hatch =
    "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in oklab, currentColor 12%, transparent) 6px 8px)";

  return (
    <div
      className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800"
      data-testid="timeline"
    >
      <div style={{ width: width + LABEL_WIDTH }}>
        {/* ticks */}
        <div
          className="flex border-neutral-200 border-b text-xs dark:border-neutral-800"
          style={{ height: 28 }}
        >
          <div
            className="shrink-0 border-neutral-200 border-r dark:border-neutral-800"
            style={{ width: LABEL_WIDTH }}
          />
          <div className="relative" style={{ width }}>
            {ticks.map((t) => (
              <span
                key={t.iso}
                className="absolute top-1 -translate-x-1/2 opacity-70"
                style={{ left: minuteToX(t.minute) }}
                data-testid="tick"
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {printers.map((printer) => {
          const laneSlots = slots.filter((s) => s.printers.some((p) => p.id === printer.id));
          const preview =
            drag && drag.printer.id === printer.id
              ? drag.kind === "create"
                ? {
                    start: Math.min(drag.anchor, drag.current),
                    end: Math.max(drag.anchor, drag.current),
                  }
                : null
              : null;
          return (
            <div
              key={printer.id}
              className="flex border-neutral-200 border-b last:border-b-0 dark:border-neutral-800"
              style={{ height: LANE_HEIGHT }}
              data-testid="lane"
              data-printer-id={printer.id}
            >
              <div
                className="flex shrink-0 flex-col justify-center gap-1 border-neutral-200 border-r px-3 dark:border-neutral-800"
                style={{ width: LABEL_WIDTH }}
              >
                <span
                  className={`truncate font-medium text-sm ${printer.invisible ? "opacity-60" : ""}`}
                >
                  {printer.name}
                </span>
                {printer.invisible ? (
                  <span className="text-xs opacity-60">not bookable</span>
                ) : (
                  <button
                    type="button"
                    className="w-fit text-xs underline"
                    onClick={() => {
                      const start = snapMinutes(Math.max(nowInDay ? nowMinute : 0, 0), "ceil");
                      onCreate({
                        printer,
                        start_at: isoFromMs(Date.parse(bounds.from) + start * 60_000),
                        end_at: isoFromMs(
                          Date.parse(bounds.from) + Math.min(start + 60, bounds.minutes) * 60_000,
                        ),
                      });
                    }}
                    aria-label={`Book ${printer.name}`}
                  >
                    + Book
                  </button>
                )}
              </div>
              <div
                ref={(el) => {
                  if (el) laneRefs.current.set(printer.id, el);
                  else laneRefs.current.delete(printer.id);
                }}
                className={`relative ${printer.invisible ? "" : "cursor-crosshair"}`}
                style={{ width, touchAction: "none" }}
                onPointerDown={onLanePointerDown(printer)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => setDrag(null)}
                data-testid="lane-track"
              >
                {/* hatched: the past, or the whole lane for invisible printers */}
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 opacity-60"
                  style={{
                    width: printer.invisible ? width : minuteToX(pastMinutes),
                    backgroundImage: hatch,
                  }}
                  aria-hidden="true"
                />
                {ticks.map((t) => (
                  <div
                    key={t.iso}
                    className="pointer-events-none absolute inset-y-0 border-neutral-200 border-l dark:border-neutral-800"
                    style={{ left: minuteToX(t.minute) }}
                    aria-hidden="true"
                  />
                ))}
                {laneSlots.map((slot) => {
                  const start = Math.max(minutesInto(slot.start_at, bounds.from), 0);
                  const end = Math.min(minutesInto(slot.end_at, bounds.from), bounds.minutes);
                  const editable = canEditSlot(me.data, slot);
                  const running = slotIsRunning(slot, now);
                  const resizing =
                    drag?.kind === "resize" && drag.slot?.id === slot.id ? drag.current : null;
                  return (
                    <div key={slot.id} className="contents">
                      <SlotCard
                        slot={slot}
                        editable={editable}
                        running={running}
                        onOpen={onOpen}
                        left={minuteToX(start)}
                        width={minuteToX((resizing ?? end) - start)}
                      />
                      {editable ? (
                        <button
                          type="button"
                          className="absolute top-1 bottom-1 w-2 cursor-ew-resize rounded-r-md opacity-0 hover:opacity-100 focus:opacity-100"
                          style={{
                            left: minuteToX(resizing ?? end) - 8,
                            backgroundColor: slot.user.color,
                          }}
                          onPointerDown={onHandlePointerDown(printer, slot)}
                          onPointerMove={(e) => {
                            e.stopPropagation();
                            onPointerMove(e);
                          }}
                          onPointerUp={(e) => {
                            e.stopPropagation();
                            onPointerUp();
                          }}
                          aria-label={`Drag to change the end of ${slot.name}`}
                          title="Drag to change the end time"
                          data-testid="resize-handle"
                        />
                      ) : null}
                    </div>
                  );
                })}
                {preview ? (
                  <div
                    className="pointer-events-none absolute top-1 bottom-1 rounded-md border-2 border-dashed border-neutral-500"
                    style={{
                      left: minuteToX(preview.start),
                      width: Math.max(minuteToX(preview.end - preview.start), 2),
                    }}
                    aria-hidden="true"
                  />
                ) : null}
                {nowInDay ? (
                  <div
                    className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-500"
                    style={{ left: minuteToX(nowMinute) }}
                    aria-hidden="true"
                    data-testid="now-line"
                    title={formatTime(isoFromMs(now), tz, fmt)}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
