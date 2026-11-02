import type { Me, Printer, Slot } from "@production-line/shared";
import {
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  type RangeDay,
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
/** Card windowing: re-measure in 12-hour steps, keep a day of cards beyond each viewport edge. */
const WINDOW_STEP = 12 * 60;
const WINDOW_SLACK = 24 * 60;

/** Minutes into the strip that lanes currently mount cards for. */
interface ViewWindow {
  from: number;
  to: number;
}

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

/** Where a slot sits, in minutes into the strip, including an in-progress drag on it. */
function displayRange(slot: Slot, stripFrom: string, drag: DragState | null) {
  let start = minutesInto(slot.start_at, stripFrom);
  let end = minutesInto(slot.end_at, stripFrom);
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
}

/** Everything the pointer handlers need, kept in a ref so the handlers themselves stay stable. */
interface Live {
  stripFrom: string;
  stripMinutes: number;
  nowMinute: number;
  horizonMinute: number;
  liveLo: number;
  liveHi: number;
  vertical: boolean;
  onCreate: TimelineProps["onCreate"];
  onOpen: TimelineProps["onOpen"];
  onChange: TimelineProps["onChange"];
}

/**
 * The timeline strip (dev doc §11.2): one lane per printer running from shortly before now to the
 * 30-day booking horizon, scrolling across days. Hour ticks, date markers at midnight, hatched
 * past and beyond-horizon, current-time line, drag-to-create on empty lane space, drag either edge
 * of your own cards to change start/end, and drag a card's body to move it (mouse/pen only: on
 * touch a tap opens the editor instead, so the page still scrolls). Every drag is clamped to the
 * bookable window, so nothing lands in the past or past the horizon. A tap without movement books
 * an hour at that time; keyboard users create via the per-lane "Book" button.
 *
 * Each lane is memoised: a drag re-renders only its own lane, and page state (heading, notices,
 * the editor) never touches the cards. With thousands of slots that is the difference between a
 * smooth scroll and a stall.
 */
export const Timeline = memo(function Timeline({
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
  const ticks = useMemo(
    () => rangeTicks(strip.from, strip.to, tz, fmt),
    [strip.from, strip.to, tz, fmt],
  );
  const days = useMemo(() => rangeDays(strip.from, strip.to, tz), [strip.from, strip.to, tz]);
  const length = minuteToX(strip.minutes);
  const nowMinute = Math.min(Math.max(minutesInto(isoFromMs(now), strip.from), 0), strip.minutes);
  const horizonMinute = Math.min(minutesInto(isoFromMs(horizon), strip.from), strip.minutes);
  // The bookable window: the first 5-minute mark not yet past, through the horizon.
  const liveLo = snapMinutes(nowMinute, "ceil");
  const liveHi = snapMinutes(horizonMinute, "floor");
  const [drag, setDragState] = useState<DragState | null>(null);
  // Pointer events can arrive faster than React renders; the ref is the source of truth for the
  // handlers and the state only drives rendering.
  const dragRef = useRef<DragState | null>(null);
  const setDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  }, []);
  const laneRefs = useRef(new Map<number, HTMLDivElement>());
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Only cards near the viewport are mounted. The window is quantised to 12-hour steps with a
  // day of slack on each side, so scrolling re-renders the lanes a couple of times per day of
  // travel instead of on every frame, and a 30-day strip with thousands of slots stays light.
  const [viewWindow, setViewWindow] = useState<ViewWindow | null>(null);
  const measureWindow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const v = live.current.vertical;
    const offset = xToMinute(v ? el.scrollTop : el.scrollLeft);
    const size = xToMinute(v ? el.clientHeight : el.clientWidth);
    const from = Math.floor((offset - WINDOW_SLACK) / WINDOW_STEP) * WINDOW_STEP;
    const to = Math.ceil((offset + size + WINDOW_SLACK) / WINDOW_STEP) * WINDOW_STEP;
    setViewWindow((w) => (w && w.from === from && w.to === to ? w : { from, to }));
  }, []);
  useLayoutEffect(() => {
    measureWindow();
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measureWindow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureWindow]);

  // Handlers read the latest values through this ref, so they can be created once and the lanes
  // they are passed to can be memoised.
  const live = useRef<Live>({
    stripFrom: strip.from,
    stripMinutes: strip.minutes,
    nowMinute,
    horizonMinute,
    liveLo,
    liveHi,
    vertical,
    onCreate,
    onOpen,
    onChange,
  });
  useEffect(() => {
    live.current = {
      stripFrom: strip.from,
      stripMinutes: strip.minutes,
      nowMinute,
      horizonMinute,
      liveLo,
      liveHi,
      vertical,
      onCreate,
      onOpen,
      onChange,
    };
  });

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
    measureWindow();
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

  const minuteAt = useCallback((printerId: number, clientX: number, clientY: number) => {
    const el = laneRefs.current.get(printerId);
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const px = live.current.vertical ? clientY - rect.top : clientX - rect.left;
    return Math.min(Math.max(xToMinute(px), 0), live.current.stripMinutes);
  }, []);

  /** Clamps a pointer position to what the drag may legally produce (dev doc §3.3). */
  const clampFor = useCallback((d: DragState, m: number): number => {
    const { stripFrom, liveLo: lo, liveHi: hi } = live.current;
    const s = d.slot ? minutesInto(d.slot.start_at, stripFrom) : 0;
    const e = d.slot ? minutesInto(d.slot.end_at, stripFrom) : 0;
    switch (d.kind) {
      case "create":
        return Math.min(Math.max(m, lo), hi);
      case "resize-start":
        return Math.min(Math.max(m, lo), e - 5);
      case "resize-end":
        return Math.min(Math.max(m, s + 5, lo), hi);
      case "move": {
        const delta = Math.min(Math.max(m - d.anchor, lo - s), hi - e);
        return d.anchor + delta;
      }
    }
  }, []);

  const onLanePointerDown = useCallback(
    (printer: Printer, e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || printer.invisible || e.target !== e.currentTarget) return;
      const raw = minuteAt(printer.id, e.clientX, e.clientY);
      // The hatched past and beyond-horizon areas aren't bookable; a press there does nothing.
      if (raw < live.current.nowMinute || raw > live.current.horizonMinute) return;
      const m = Math.max(snapMinutes(raw, "floor"), live.current.liveLo);
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ kind: "create", printer, anchor: m, current: m, moved: false });
    },
    [minuteAt, setDrag],
  );

  const onHandlePointerDown = useCallback(
    (
      printer: Printer,
      slot: Slot,
      edge: "start" | "end",
      e: ReactPointerEvent<HTMLButtonElement>,
    ) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const m = minutesInto(edge === "end" ? slot.end_at : slot.start_at, live.current.stripFrom);
      setDrag({
        kind: edge === "end" ? "resize-end" : "resize-start",
        printer,
        slot,
        anchor: m,
        current: m,
        moved: false,
      });
    },
    [setDrag],
  );

  const onCardPointerDown = useCallback(
    (printer: Printer, slot: Slot, e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const m = snapMinutes(minuteAt(printer.id, e.clientX, e.clientY));
      setDrag({ kind: "move", printer, slot, anchor: m, current: m, moved: false });
    },
    [minuteAt, setDrag],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const m = clampFor(d, snapMinutes(minuteAt(d.printer.id, e.clientX, e.clientY)));
      if (m !== d.current) setDrag({ ...d, current: m, moved: true });
    },
    [clampFor, minuteAt, setDrag],
  );

  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    setDrag(null);
    const {
      stripFrom,
      liveHi: hi,
      onCreate: create,
      onOpen: open,
      onChange: change,
    } = live.current;
    const iso = (m: number) => isoFromMs(Date.parse(stripFrom) + m * 60_000);
    if (d.kind === "create") {
      let start = Math.min(d.anchor, d.current);
      let end = Math.max(d.anchor, d.current);
      if (!d.moved || end - start < 5) {
        start = d.anchor;
        end = Math.min(d.anchor + 60, hi);
      }
      if (end - start < 5) return;
      create({ printer: d.printer, start_at: iso(start), end_at: iso(end) });
    } else if (d.slot && !d.moved) {
      // A click (no movement) on a card opens it.
      if (d.kind === "move") open(d.slot);
    } else if (d.slot) {
      const { start, end } = displayRange(d.slot, stripFrom, d);
      if (d.kind === "resize-end") change(d.slot, { end_at: iso(end) });
      else if (d.kind === "resize-start") change(d.slot, { start_at: iso(start) });
      else change(d.slot, { start_at: iso(start), end_at: iso(end) });
    }
  }, [setDrag]);

  const onPointerCancel = useCallback(() => setDrag(null), [setDrag]);

  /** "Book" on a lane label books an hour at the leading edge of what you're looking at. */
  const book = useCallback((printer: Printer) => {
    const el = scrollerRef.current;
    const { vertical: v, liveLo: lo, liveHi: hi, stripFrom, onCreate: create } = live.current;
    const viewMinute = el ? xToMinute(v ? el.scrollTop : el.scrollLeft) : 0;
    const start = Math.min(Math.max(snapMinutes(viewMinute, "ceil"), lo), hi - 5);
    create({
      printer,
      start_at: isoFromMs(Date.parse(stripFrom) + start * 60_000),
      end_at: isoFromMs(Date.parse(stripFrom) + Math.min(start + 60, hi) * 60_000),
    });
  }, []);

  const setLaneRef = useCallback((printerId: number, el: HTMLDivElement | null) => {
    if (el) laneRefs.current.set(printerId, el);
    else laneRefs.current.delete(printerId);
  }, []);

  // Slots per printer, recomputed only when the slot list changes.
  const slotsByPrinter = useMemo(() => {
    const map = new Map<number, Slot[]>();
    for (const slot of slots) {
      for (const p of slot.printers) {
        const list = map.get(p.id) ?? [];
        list.push(slot);
        map.set(p.id, list);
      }
    }
    return map;
  }, [slots]);
  const EMPTY: Slot[] = useMemo(() => [], []);

  const laneProps = (printer: Printer) => ({
    printer,
    slots: slotsByPrinter.get(printer.id) ?? EMPTY,
    window: viewWindow,
    // Only the lane being dragged sees the drag, so the others keep their memoised render.
    drag: drag && drag.printer.id === printer.id ? drag : null,
    stripFrom: strip.from,
    stripMinutes: strip.minutes,
    length,
    nowMinute,
    horizonMinute,
    now,
    nowLabel: formatTime(isoFromMs(now), tz, fmt),
    days,
    vertical,
    me: me.data ?? null,
    setLaneRef,
    onLanePointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onCardPointerDown,
    onHandlePointerDown,
    onOpen,
  });

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
            className="glass-strong sticky top-0 left-0 z-[2] border-line border-x-0 border-t-0 border-b bg-(--glass-solid) shadow-none"
            style={{ height: COLUMN_HEADER }}
          />
          {printers.map((printer) => (
            <div
              key={printer.id}
              className="glass-strong sticky top-0 z-[1] flex flex-col justify-center border-line border-x-0 border-t-0 border-b bg-(--glass-solid) text-center shadow-none"
              style={{ height: COLUMN_HEADER }}
              data-testid="lane"
              data-printer-id={printer.id}
            >
              <LaneLabel printer={printer} onBook={book} />
            </div>
          ))}
          {/* body row: tick gutter + one lane per printer */}
          <div
            className="glass-strong sticky left-0 z-[1] border-line border-y-0 border-r border-l-0 bg-(--glass-solid) shadow-none"
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
              <LaneBody {...laneProps(printer)} />
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
            className="glass-strong sticky left-0 z-[2] shrink-0 border-line border-y-0 border-r border-l-0 bg-(--glass-solid) shadow-none"
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
              className="glass-strong sticky left-0 z-[2] flex shrink-0 flex-col justify-center border-line border-y-0 border-r border-l-0 bg-(--glass-solid) shadow-none"
              style={{ width: LABEL_WIDTH }}
            >
              <LaneLabel printer={printer} onBook={book} />
            </div>
            <LaneBody {...laneProps(printer)} />
          </div>
        ))}
      </div>
    </div>
  );
});

interface LaneBodyProps {
  printer: Printer;
  slots: Slot[];
  window: ViewWindow | null;
  drag: DragState | null;
  stripFrom: string;
  stripMinutes: number;
  length: number;
  nowMinute: number;
  horizonMinute: number;
  now: number;
  nowLabel: string;
  days: RangeDay[];
  vertical: boolean;
  me: Me | null;
  setLaneRef: (printerId: number, el: HTMLDivElement | null) => void;
  onLanePointerDown: (printer: Printer, e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onCardPointerDown: (
    printer: Printer,
    slot: Slot,
    e: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onHandlePointerDown: (
    printer: Printer,
    slot: Slot,
    edge: "start" | "end",
    e: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onOpen: (slot: Slot) => void;
}

/** One printer's lane: hatching, day lines, cards with handles, the create preview, the now line. */
const LaneBody = memo(function LaneBody({
  printer,
  slots,
  window,
  drag,
  stripFrom,
  stripMinutes,
  length,
  nowMinute,
  horizonMinute,
  now,
  nowLabel,
  days,
  vertical,
  me,
  setLaneRef,
  onLanePointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onCardPointerDown,
  onHandlePointerDown,
  onOpen,
}: LaneBodyProps) {
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
  const preview =
    drag && drag.kind === "create"
      ? { start: Math.min(drag.anchor, drag.current), end: Math.max(drag.anchor, drag.current) }
      : null;
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
  const handleClass = `absolute opacity-0 hover:opacity-100 focus:opacity-100 ${
    vertical ? "inset-x-1 h-2 cursor-ns-resize" : "inset-y-1 w-2 cursor-ew-resize"
  }`;
  // Cards outside the window (plus the one being dragged, wherever it is) stay unmounted.
  const visible = useMemo(() => {
    if (!window) return [];
    const fromMs = Date.parse(stripFrom) + window.from * 60_000;
    const toMs = Date.parse(stripFrom) + window.to * 60_000;
    return slots.filter(
      (s) =>
        s.id === drag?.slot?.id || (Date.parse(s.start_at) < toMs && Date.parse(s.end_at) > fromMs),
    );
  }, [slots, window, stripFrom, drag?.slot?.id]);

  return (
    <div
      ref={(el) => setLaneRef(printer.id, el)}
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
      onPointerDown={(e) => onLanePointerDown(printer, e)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
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
      {visible.map((slot) => {
        const range = displayRange(slot, stripFrom, drag);
        const start = Math.max(range.start, 0);
        const end = Math.min(range.end, stripMinutes);
        const editable = canEditSlot(me, slot);
        const running = slotIsRunning(slot, now);
        // A running slot's start is locked (dev doc §3.3), so it can neither move nor grow left.
        const movable = editable && !running;
        const startPx = minuteToX(start);
        const endPx = minuteToX(end);
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
              onPointerDown={movable ? (e) => onCardPointerDown(printer, slot, e) : undefined}
              onPointerMove={movable ? handleEvents.onPointerMove : undefined}
              onPointerUp={movable ? handleEvents.onPointerUp : undefined}
              dragging={drag?.kind === "move" && drag.slot?.id === slot.id && drag.moved}
            />
            {movable ? (
              <button
                type="button"
                className={`${handleClass} ${vertical ? "rounded-t-md" : "rounded-l-md"}`}
                style={{ ...along(startPx), backgroundColor: slot.user.color, touchAction: "none" }}
                onPointerDown={(e) => onHandlePointerDown(printer, slot, "start", e)}
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
                onPointerDown={(e) => onHandlePointerDown(printer, slot, "end", e)}
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
        title={nowLabel}
      />
    </div>
  );
});

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
