import type { Slot } from "@production-line/shared";
import { useTimeFormat, useTimeZone } from "../lib/prefs.ts";
import { formatRange } from "../lib/time.ts";

interface SlotCardProps {
  slot: Slot;
  editable: boolean;
  running: boolean;
  onOpen: (slot: Slot) => void;
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
  onOpen,
  offset,
  length,
  vertical,
}: SlotCardProps) {
  const tz = useTimeZone();
  const fmt = useTimeFormat();
  const label = `${slot.name}, ${slot.user.username}, ${formatRange(slot.start_at, slot.end_at, tz, fmt)}`;
  const size = Math.max(length, 6);
  return (
    <button
      type="button"
      className={`absolute overflow-hidden rounded-lg border px-2 py-1 text-left text-ink text-xs leading-tight shadow-sm backdrop-blur-sm ${
        vertical ? "inset-x-1" : "inset-y-1"
      } ${running ? "ring-2 ring-accent/60" : ""}`}
      style={{
        ...(vertical ? { top: offset, height: size } : { left: offset, width: size }),
        backgroundColor: `color-mix(in oklab, ${slot.user.color} 32%, var(--glass))`,
        borderColor: `color-mix(in oklab, ${slot.user.color} 70%, transparent)`,
        [vertical ? "borderTopWidth" : "borderLeftWidth"]: 3,
        [vertical ? "borderTopColor" : "borderLeftColor"]: slot.user.color,
      }}
      onClick={() => onOpen(slot)}
      aria-label={`${editable ? "Edit" : "View"} slot ${label}`}
      title={label}
      data-testid="slot-card"
      data-slot-id={slot.id}
      data-running={running ? "true" : "false"}
      data-geometry="time"
    >
      <span className="block truncate font-medium">{slot.name}</span>
      <span className="block truncate opacity-80">
        {slot.user.username}
        {running ? " · running" : ""}
      </span>
    </button>
  );
}
