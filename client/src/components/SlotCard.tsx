import type { Slot } from "@production-line/shared";
import { useTimeFormat, useTimeZone } from "../lib/prefs.ts";
import { formatRange } from "../lib/time.ts";

interface SlotCardProps {
  slot: Slot;
  editable: boolean;
  running: boolean;
  onOpen: (slot: Slot) => void;
  /** Geometry inside a timeline lane, in px. */
  left: number;
  width: number;
}

/** A glass-tinted card in a printer lane (dev doc §11.2). Tint = the slot owner's color. */
export function SlotCard({ slot, editable, running, onOpen, left, width }: SlotCardProps) {
  const tz = useTimeZone();
  const fmt = useTimeFormat();
  const label = `${slot.name}, ${slot.user.username}, ${formatRange(slot.start_at, slot.end_at, tz, fmt)}`;
  return (
    <button
      type="button"
      className="absolute top-1 bottom-1 overflow-hidden rounded-md border px-2 py-1 text-left text-xs leading-tight shadow-sm focus:outline-2 focus:outline-offset-1"
      style={{
        left,
        width: Math.max(width, 6),
        backgroundColor: `color-mix(in oklab, ${slot.user.color} 35%, transparent)`,
        borderColor: slot.user.color,
      }}
      onClick={() => onOpen(slot)}
      aria-label={`${editable ? "Edit" : "View"} slot ${label}`}
      title={label}
      data-testid="slot-card"
      data-slot-id={slot.id}
      data-running={running ? "true" : "false"}
    >
      <span className="block truncate font-medium">{slot.name}</span>
      <span className="block truncate opacity-80">
        {slot.user.username}
        {running ? " · running" : ""}
      </span>
    </button>
  );
}
