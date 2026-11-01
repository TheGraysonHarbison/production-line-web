import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { useLogout, useMe } from "../lib/auth.tsx";
import { useEditor } from "../lib/editor.tsx";
import { useTimeZone } from "../lib/prefs.ts";
import { todayPlainDate } from "../lib/time.ts";
import { Avatar } from "./Avatar.tsx";
import { StreamDot } from "./Dock.tsx";
import {
  CalendarIcon,
  PlusIcon,
  PrinterIcon,
  SettingsIcon,
  SignOutIcon,
  TimelineIcon,
  TodayIcon,
} from "./Icons.tsx";

const item =
  "inline-flex h-12 w-12 items-center justify-center rounded-xl transition-colors hover:bg-accent-soft";
const active = "bg-accent text-on-accent hover:bg-accent";

/** Tablet rail (dev doc §11.1): the dock collapsed to icons; the printer list opens as a drawer. */
export function Rail({ onOpenPrinters }: { onOpenPrinters: () => void }) {
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
    <aside
      className="glass sticky top-0 flex h-dvh w-[72px] shrink-0 flex-col items-center gap-2 rounded-r-2xl border-y-0 border-l-0 py-3"
      data-testid="rail"
    >
      <Link to="/" className="mb-1 font-bold text-accent text-lg" aria-label="Production Line">
        PL
      </Link>
      <StreamDot withLabel={false} />
      <nav aria-label="Main" className="flex flex-col items-center gap-1">
        <button
          type="button"
          className={item}
          onClick={() => navigate(`/day/${today}`)}
          aria-label="Today"
          title="Today"
        >
          <TodayIcon />
        </button>
        <NavLink
          to="/"
          end
          className={({ isActive }) => `${item} ${isActive ? active : ""}`}
          aria-label="Calendar"
          title="Calendar"
        >
          <CalendarIcon />
        </NavLink>
        <button
          type="button"
          className={`${item} ${onTimeline ? active : ""}`}
          onClick={() => navigate(`/day/${today}`)}
          aria-pressed={onTimeline}
          aria-label="Timeline"
          title="Timeline"
        >
          <TimelineIcon />
        </button>
        <button
          type="button"
          className={`${item} border border-accent/40 text-accent`}
          onClick={() => editor.openCreate()}
          aria-label="New slot"
          title="New slot"
          data-testid="new-slot"
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className={item}
          onClick={onOpenPrinters}
          aria-label="Printers"
          title="Printers"
          data-testid="open-printers"
        >
          <PrinterIcon />
        </button>
        <NavLink
          to="/settings"
          className={({ isActive }) => `${item} ${isActive ? active : ""}`}
          aria-label="Settings"
          title="Settings"
        >
          <SettingsIcon />
        </NavLink>
      </nav>
      <div className="mt-auto flex flex-col items-center gap-1">
        <Link to="/settings/profile" className={item} title={user.username}>
          <Avatar user={user} size={32} />
          <span className="sr-only" data-testid="current-username">
            {user.username}
          </span>
        </Link>
        <button
          type="button"
          className={`${item} text-ink-muted`}
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
