import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { useLogout, useMe } from "../lib/auth.tsx";
import { usePrinters, useSlotsRange } from "../lib/data.ts";
import { useEditor } from "../lib/editor.tsx";
import { useTimeFormat, useTimeZone } from "../lib/prefs.ts";
import { printerAvailability } from "../lib/slots.ts";
import { useStreamStatus } from "../lib/stream.ts";
import { dayBounds, formatTime, todayPlainDate } from "../lib/time.ts";
import { Avatar } from "./Avatar.tsx";

/** Left dock (dev doc §11.1): toolbar + printer list with availability for today. */
export function Dock() {
  const me = useMe();
  const logout = useLogout();
  const status = useStreamStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const editor = useEditor();
  const tz = useTimeZone();
  const fmt = useTimeFormat();
  const printers = usePrinters();

  const today = todayPlainDate(tz);
  const bounds = dayBounds(today, tz);
  const todaySlots = useSlotsRange(bounds.from, bounds.to);
  const onTimeline = location.pathname.startsWith("/day/");
  const user = me.data;
  if (!user) return null;

  const btn = "rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700";
  const active = "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900";

  return (
    <aside className="flex w-full flex-col gap-4 border-neutral-200 border-b p-4 lg:h-dvh lg:w-[280px] lg:shrink-0 lg:border-r lg:border-b-0 dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <Link to="/" className="font-semibold text-lg tracking-tight">
          Production Line
        </Link>
        <span
          className="flex items-center gap-1 text-xs opacity-80"
          data-testid="stream-status"
          data-status={status}
          title={status === "live" ? "Live updates connected" : "Reconnecting to live updates"}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-2 rounded-full ${status === "live" ? "bg-green-500" : "bg-amber-500"}`}
          />
          <span className="hidden sm:inline">
            {status === "live" ? "Live" : status === "closed" ? "Offline" : "Reconnecting…"}
          </span>
        </span>
      </div>

      <nav aria-label="Main" className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => navigate(`/day/${today}`)}>
          Today
        </button>
        <NavLink to="/" end className={({ isActive }) => `${btn} ${isActive ? active : ""}`}>
          Calendar
        </NavLink>
        <button
          type="button"
          className={`${btn} ${onTimeline ? active : ""}`}
          onClick={() => navigate(`/day/${today}`)}
          aria-pressed={onTimeline}
        >
          Timeline
        </button>
        <button
          type="button"
          className={`${btn} font-medium`}
          onClick={() => editor.openCreate()}
          data-testid="new-slot"
        >
          + New slot
        </button>
        <NavLink to="/settings" className={({ isActive }) => `${btn} ${isActive ? active : ""}`}>
          Settings
        </NavLink>
      </nav>

      <section className="min-h-0 flex-1 overflow-y-auto">
        <h2 className="mb-2 font-medium text-sm uppercase tracking-wide opacity-70">Printers</h2>
        {printers.isPending ? <p className="text-sm opacity-70">Loading…</p> : null}
        {printers.data?.length === 0 ? (
          <p className="text-sm opacity-70">No printers yet.</p>
        ) : null}
        <ul className="flex flex-col gap-1" data-testid="dock-printers">
          {printers.data?.map((p) => {
            const a = printerAvailability(p, todaySlots.data ?? []);
            return (
              <li
                key={p.id}
                className={`rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800 ${p.invisible ? "opacity-60" : ""}`}
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-xs opacity-70" data-testid="printer-availability">
                  {a.state === "free" && "Free today"}
                  {a.state === "invisible" && "Not bookable"}
                  {a.state === "busy_until" &&
                    `Busy until ${formatTime(a.at, tz, fmt)} · ${a.by.username}`}
                  {a.state === "free_until" &&
                    `Free until ${formatTime(a.at, tz, fmt)} · ${a.by.username}`}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex items-center gap-3 border-neutral-200 border-t pt-3 dark:border-neutral-800">
        <Avatar user={user} size={32} />
        <span className="truncate text-sm" data-testid="current-username">
          {user.username}
        </span>
        <button
          type="button"
          className={`${btn} ml-auto`}
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
