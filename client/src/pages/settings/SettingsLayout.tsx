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
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <nav
        aria-label="Settings"
        className="flex flex-wrap gap-2 border-neutral-200 border-b pb-3 dark:border-neutral-800"
      >
        {TABS.filter((t) => RANK[t.role] <= rank).map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `rounded-md px-3 py-1 text-sm ${isActive ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "opacity-80"}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
