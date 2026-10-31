import { Link, NavLink, Outlet } from "react-router";
import { Avatar } from "../components/Avatar.tsx";
import { useLogout, useMe } from "../lib/auth.tsx";
import { useEventStream, useStreamStatus } from "../lib/stream.ts";

/** Minimal authenticated frame. The real dock/tab-bar layout arrives with the calendar (Phase 6/7). */
export function Shell() {
  const me = useMe();
  const logout = useLogout();
  const user = me.data;
  useEventStream(user?.id);
  const status = useStreamStatus();
  if (!user) return null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-neutral-200 border-b px-4 py-3 dark:border-neutral-800">
        <Link to="/" className="font-semibold text-lg tracking-tight">
          Production Line
        </Link>
        <nav className="flex gap-3 text-sm">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "underline" : "opacity-80")}>
            Home
          </NavLink>
          <NavLink
            to="/settings/profile"
            className={({ isActive }) => (isActive ? "underline" : "opacity-80")}
          >
            Settings
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3">
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
          <Avatar user={user} size={32} />
          <span className="text-sm" data-testid="current-username">
            {user.username}
          </span>
          <button
            type="button"
            className="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="flex-1 px-4 py-6">
        <Outlet />
      </div>
    </div>
  );
}
