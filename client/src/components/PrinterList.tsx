import { usePrinters, useSlotsRange } from "../lib/data.ts";
import { useEditor } from "../lib/editor.tsx";
import { useTimeFormat, useTimeZone } from "../lib/prefs.ts";
import { printerAvailability } from "../lib/slots.ts";
import { dayBounds, formatTime, isoFromMs, snapIsoToFive, todayPlainDate } from "../lib/time.ts";
import { PlusIcon } from "./Icons.tsx";

/**
 * The printer list with each printer's availability for today (dev doc §11.1). Lives in the
 * desktop dock, the tablet drawer, and the mobile Printers tab. `bookable` adds a Book button for
 * layouts without a timeline lane to drag on.
 */
export function PrinterList({
  bookable = false,
  onBook,
}: {
  bookable?: boolean;
  /** Called after the editor opens from a Book button (the tablet drawer closes itself). */
  onBook?: (() => void) | undefined;
}) {
  const tz = useTimeZone();
  const fmt = useTimeFormat();
  const printers = usePrinters();
  const editor = useEditor();
  const today = todayPlainDate(tz);
  const bounds = dayBounds(today, tz);
  const todaySlots = useSlotsRange(bounds.from, bounds.to);

  const book = (printerId: number) => {
    const start = snapIsoToFive(isoFromMs(Date.now()), "ceil");
    editor.openCreate({
      start_at: start,
      end_at: isoFromMs(Date.parse(start) + 60 * 60_000),
      printer_ids: [printerId],
    });
    onBook?.();
  };

  return (
    <div className="flex flex-col gap-2">
      {printers.isPending ? <p className="text-ink-muted text-sm">Loading…</p> : null}
      {printers.data?.length === 0 ? (
        <p className="text-ink-muted text-sm">No printers yet.</p>
      ) : null}
      <ul className="flex flex-col gap-1.5" data-testid="dock-printers">
        {printers.data?.map((p) => {
          const a = printerAvailability(p, todaySlots.data ?? []);
          return (
            <li
              key={p.id}
              className={`flex items-center gap-2 rounded-lg border border-line bg-canvas/40 px-3 py-2 ${p.invisible ? "opacity-60" : ""}`}
            >
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  a.state === "busy_until"
                    ? "bg-warn"
                    : a.state === "invisible"
                      ? "bg-ink-muted"
                      : "bg-ok"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                <div className="text-ink-muted text-xs" data-testid="printer-availability">
                  {a.state === "free" && "Free today"}
                  {a.state === "invisible" && "Not bookable"}
                  {a.state === "busy_until" && `Busy until ${formatTime(a.at, tz, fmt)}`}
                  {a.state === "free_until" && `Free until ${formatTime(a.at, tz, fmt)}`}
                </div>
                {a.state === "busy_until" || a.state === "free_until" ? (
                  <button
                    type="button"
                    className="flex max-w-full items-center gap-1.5 truncate rounded text-left text-xs hover:text-accent"
                    onClick={() => editor.openEdit(a.slot)}
                    title={`${a.state === "busy_until" ? "Printing now" : "Next up"}: ${a.slot.name} · ${a.by.username}`}
                    data-testid="printer-occupant"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: a.by.color }}
                    />
                    <span className="truncate">
                      <span className="sr-only">
                        {a.state === "busy_until" ? "Printing now: " : "Next up: "}
                      </span>
                      <span className="font-medium text-ink">{a.slot.name}</span>
                      <span className="text-ink-muted"> · {a.by.username}</span>
                    </span>
                  </button>
                ) : null}
              </div>
              {bookable && !p.invisible ? (
                <button
                  type="button"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-accent hover:bg-accent-soft"
                  onClick={() => book(p.id)}
                  aria-label={`Book ${p.name}`}
                  title="Book now"
                >
                  <PlusIcon />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
