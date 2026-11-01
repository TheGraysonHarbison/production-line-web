import type { Role } from "@production-line/shared";
import { Navigate, NavLink, Outlet, useLocation } from "react-router";
import { useMe } from "../../lib/auth.tsx";

const RANK: Record<Role, number> = { user: 0, admin: 1, owner: 2 };

const TABS: { to: string; label: string; role: Role }[] = [
  { to: "/settings/profile", label: "Profile", role: "user" },
  { to: "/settings/printers", label: "Printers", role: "admin" },
  { to: "/settings/general", label: "General", role: "admin" },
  { to: "/settings/home-assistant", label: "Home Assistant", role: "admin" },
  { to: "/settings/users", label: "Users", role: "owner" },
];

/** Settings tabs, filtered by role (dev doc §11.2). Visiting a tab above your role bounces to Profile. */
export function SettingsLayout() {
  const me = useMe();
  const location = useLocation();
  if (!me.data) return null;
  const rank = RANK[me.data.role];
  const current = TABS.find((t) => t.to === location.pathname);
  if (current && RANK[current.role] > rank) return <Navigate to="/settings/profile" replace />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <nav
        aria-label="Settings"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
      >
        {TABS.filter((t) => RANK[t.role] <= rank).map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm transition-colors ${
                isActive
                  ? "bg-accent font-medium text-on-accent"
                  : "text-ink-muted hover:bg-accent-soft hover:text-ink"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <div className="glass rounded-2xl p-4 sm:p-6">
        <Outlet />
      </div>
    </div>
  );
}
