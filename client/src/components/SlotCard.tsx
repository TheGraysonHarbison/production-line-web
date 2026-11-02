import type { Slot } from "@production-line/shared";
import { type MouseEvent, type PointerEvent as ReactPointerEvent, useRef } from "react";
import { useTimeFormat, useTimeZone } from "../lib/prefs.ts";
import { formatRange } from "../lib/time.ts";
import { ImageIcon } from "./Icons.tsx";

type PointerHandler = (e: ReactPointerEvent<HTMLButtonElement>) => void;

interface SlotCardProps {
  slot: Slot;
  editable: boolean;
  running: boolean;
  /** The body can be dragged to move the slot (mouse/pen). The timeline opens it on a plain click. */
  movable: boolean;
  dragging?: boolean;
  onOpen: (slot: Slot) => void;
  onPointerDown?: PointerHandler | undefined;
  onPointerMove?: PointerHandler | undefined;
  onPointerUp?: PointerHandler | undefined;
  /** Geometry inside a lane, in px along the time axis. */
  offset: number;
  length: number;
  vertical: boolean;
}

/** A glass card in a printer lane (dev doc §11.2), tinted by the slot owner's own color. */
export function SlotCard({
  slot,
  editable,
  running,
  movable,
  dragging = false,
  onOpen,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  offset,
  length,
  vertical,
}: SlotCardProps) {
  const tz = useTimeZone();
  const fmt = useTimeFormat();
  const lastPointer = useRef<string>("");
  const label = `${slot.name}, ${slot.user.username}, ${formatRange(slot.start_at, slot.end_at, tz, fmt)}`;
  const size = Math.max(length, 6);

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    // For movable cards the timeline opens on pointer-up without movement (so a drag never also
    // "clicks"); here we only handle keyboard activation (detail 0) and touch taps.
    if (!movable || e.detail === 0 || lastPointer.current === "touch") onOpen(slot);
    lastPointer.current = "";
  };

  return (
    <button
      type="button"
      className={`absolute overflow-hidden rounded-lg border px-2 py-1 text-left text-ink text-xs leading-tight shadow-sm ${
        vertical ? "inset-x-1" : "inset-y-1"
      } ${running ? "ring-2 ring-accent/60" : ""} ${movable ? "cursor-grab" : ""} ${
        dragging ? "cursor-grabbing opacity-80 shadow-lg" : ""
      }`}
      style={{
        ...(vertical ? { top: offset, height: size } : { left: offset, width: size }),
        backgroundColor: `color-mix(in oklab, ${slot.user.color} 32%, var(--glass))`,
        borderColor: `color-mix(in oklab, ${slot.user.color} 70%, transparent)`,
        [vertical ? "borderTopWidth" : "borderLeftWidth"]: 3,
        [vertical ? "borderTopColor" : "borderLeftColor"]: slot.user.color,
        // Touch keeps scrolling; mouse/pen drags move the slot.
        touchAction: movable ? "pan-x pan-y" : undefined,
        // Thousands of cards can sit in a 30-day strip; off-screen ones are not painted. No
        // per-card backdrop blur either: the lane surface is already glass, and blurring every
        // card made the compositor repaint them all on each scroll frame.
        contentVisibility: "auto",
      }}
      onClick={onClick}
      onPointerDown={(e) => {
        lastPointer.current = e.pointerType;
        onPointerDown?.(e);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      aria-label={`${editable ? "Edit" : "View"} slot ${label}`}
      title={movable ? `${label}. Drag to move, drag an edge to change its times.` : label}
      data-testid="slot-card"
      data-slot-id={slot.id}
      data-running={running ? "true" : "false"}
      data-geometry="time"
    >
      <span className="block truncate font-medium">{slot.name}</span>
      <span className="flex items-center gap-1 truncate opacity-80">
        <span className="truncate">
          {slot.user.username}
          {running ? " · running" : ""}
        </span>
        {slot.images.length > 0 ? (
          <span
            className="inline-flex shrink-0 items-center gap-0.5"
            title={`${slot.images.length} image${slot.images.length === 1 ? "" : "s"}`}
            data-testid="image-count"
          >
            <ImageIcon size={12} />
            {slot.images.length}
          </span>
        ) : null}
      </span>
    </button>
  );
}
