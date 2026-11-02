import type { TimeFormat } from "@production-line/shared";

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

function hourLabel(hh: string, fmt: TimeFormat): string {
  if (fmt === "24h") return hh;
  const h = Number(hh);
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * A wall-clock time as two selects, hour and minute, where the minutes are the twelve 5-minute
 * marks (dev doc §11.2). The native time input's `step` is advisory and Firefox's picker ignores
 * it; a select enforces the grid everywhere and gives phones a wheel. `value` is "HH:MM".
 */
export function TimeSelect({
  label,
  value,
  onChange,
  fmt,
  disabled = false,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  fmt: TimeFormat;
  disabled?: boolean;
  required?: boolean;
}) {
  const [hh = "", mm = ""] = value.split(":");
  const minutes = mm && !MINUTES.includes(mm) ? [...MINUTES, mm].sort() : MINUTES;
  const selectClass =
    "min-h-11 rounded-lg border border-line-strong bg-canvas/70 px-2 py-2 text-base text-ink focus:border-accent disabled:opacity-60";
  return (
    <fieldset className="flex shrink-0 gap-1 border-0 p-0" aria-label={label} data-time={value}>
      <select
        aria-label={`${label} hour`}
        className={`${selectClass} w-26`}
        value={hh}
        onChange={(e) => onChange(`${e.target.value}:${mm || "00"}`)}
        disabled={disabled}
        required={required}
      >
        {hh === "" ? <option value="">--</option> : null}
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {hourLabel(h, fmt)}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} minute`}
        className={`${selectClass} w-18`}
        value={mm}
        onChange={(e) => onChange(`${hh || "00"}:${e.target.value}`)}
        disabled={disabled}
        required={required}
      >
        {mm === "" ? <option value="">--</option> : null}
        {minutes.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </fieldset>
  );
}
