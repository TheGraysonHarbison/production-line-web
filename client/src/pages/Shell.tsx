import { Link, NavLink, Outlet } from "react-router";
import { Avatar } from "../components/Avatar.tsx";
import { useLogout, useMe } from "../lib/auth.tsx";

/** Minimal authenticated frame. The real dock/tab-bar layout arrives with the calendar (Phase 6/7). */
export function Shell() {
  const me = useMe();
  const logout = useLogout();
  const user = me.data;
  if (!user) return null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-4 border-neutral-200 border-b px-4 py-3 dark:border-neutral-800">
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
