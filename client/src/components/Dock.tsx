import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { useLogout, useMe } from "../lib/auth.tsx";
import { useEditor } from "../lib/editor.tsx";
import { useTimeZone } from "../lib/prefs.ts";
import { useStreamStatus } from "../lib/stream.ts";
import { todayPlainDate } from "../lib/time.ts";
import { Avatar } from "./Avatar.tsx";
import {
  CalendarIcon,
  PlusIcon,
  SettingsIcon,
  SignOutIcon,
  TimelineIcon,
  TodayIcon,
} from "./Icons.tsx";
import { PrinterList } from "./PrinterList.tsx";
import { UpcomingList } from "./UpcomingList.tsx";

export function StreamDot({ withLabel = true }: { withLabel?: boolean }) {
  const status = useStreamStatus();
  const text = status === "live" ? "Live" : status === "closed" ? "Offline" : "Reconnecting…";
  return (
    <span
      className="flex items-center gap-1.5 text-ink-muted text-xs"
      data-testid="stream-status"
      data-status={status}
      title={status === "live" ? "Live updates connected" : "Reconnecting to live updates"}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-2 w-2 rounded-full ${status === "live" ? "bg-ok" : "bg-warn"}`}
      />
      <span className={withLabel ? "" : "sr-only"}>{text}</span>
    </span>
  );
}

const navItem =
  "inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent-soft";
const navActive = "bg-accent text-on-accent hover:bg-accent";

/** Desktop left dock (dev doc §11.1): toolbar, printer list with availability, current user. */
export function Dock() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const editor = useEditor();
  const tz = useTimeZone();
  const today = todayPlainDate(tz);
  const onTimeline = location.pathname.startsWith("/day/");
  const user = me.data;
  if (!user) return null;

  return (
    <aside className="glass sticky top-0 flex h-dvh w-[280px] shrink-0 flex-col gap-4 rounded-r-2xl border-y-0 border-l-0 p-4">
      <div className="flex items-center justify-between gap-2">
        <Link to="/" className="font-semibold text-lg tracking-tight">
          Production Line
        </Link>
        <StreamDot />
      </div>

      <nav aria-label="Main" className="flex flex-col gap-1">
        <button type="button" className={navItem} onClick={() => navigate(`/day/${today}`)}>
          <TodayIcon /> Today
        </button>
        <NavLink to="/" end className={({ isActive }) => `${navItem} ${isActive ? navActive : ""}`}>
          <CalendarIcon /> Calendar
        </NavLink>
        <button
          type="button"
          className={`${navItem} ${onTimeline ? navActive : ""}`}
          onClick={() => navigate(`/day/${today}`)}
          aria-pressed={onTimeline}
        >
          <TimelineIcon /> Timeline
        </button>
        <button
          type="button"
          className={`${navItem} border border-accent/40 font-medium text-accent`}
          onClick={() => editor.openCreate()}
          data-testid="new-slot"
        >
          <PlusIcon /> New slot
        </button>
      </nav>

      <section className="shrink-0">
        <h2 className="mb-1 font-medium text-ink-muted text-xs uppercase tracking-wide">
          Upcoming
        </h2>
        <UpcomingList />
      </section>

      <section className="min-h-0 flex-1 overflow-y-auto">
        <h2 className="mb-2 font-medium text-ink-muted text-xs uppercase tracking-wide">
          Printers
        </h2>
        <PrinterList />
      </section>

      <nav aria-label="Account" className="flex flex-col gap-1 border-line border-t pt-3">
        <NavLink
          to="/settings"
          className={({ isActive }) => `${navItem} ${isActive ? navActive : ""}`}
        >
          <SettingsIcon /> Settings
        </NavLink>
      </nav>

      <div className="flex items-center gap-3">
        <Avatar user={user} size={32} />
        <span className="truncate text-sm" data-testid="current-username">
          {user.username}
        </span>
        <button
          type="button"
          className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-muted hover:bg-accent-soft hover:text-ink"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          aria-label="Sign out"
          title="Sign out"
        >
          <SignOutIcon />
        </button>
      </div>
    </aside>
  );
}
