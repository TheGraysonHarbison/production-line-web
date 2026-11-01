import { Link, NavLink } from "react-router";
import { useLogout, useMe } from "../lib/auth.tsx";
import { useEditor } from "../lib/editor.tsx";
import { Avatar } from "./Avatar.tsx";
import { StreamDot } from "./Dock.tsx";
import { CalendarIcon, PlusIcon, PrinterIcon, SettingsIcon, SignOutIcon } from "./Icons.tsx";

/** Mobile top bar: brand, live indicator, who you are, sign out. */
export function MobileHeader() {
  const me = useMe();
  const logout = useLogout();
  const user = me.data;
  if (!user) return null;
  return (
    <header className="glass sticky top-0 z-10 flex items-center gap-2 rounded-b-2xl border-x-0 border-t-0 px-3 py-2">
      <Link to="/" className="font-semibold tracking-tight">
        Production Line
      </Link>
      <StreamDot withLabel={false} />
      <Link
        to="/settings/profile"
        className="ml-auto flex min-h-11 items-center gap-2 rounded-lg px-1"
        title="Profile"
      >
        <Avatar user={user} size={28} />
        <span className="max-w-[7rem] truncate text-sm" data-testid="current-username">
          {user.username}
        </span>
      </Link>
      <button
        type="button"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-muted"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        aria-label="Sign out"
        title="Sign out"
      >
        <SignOutIcon />
      </button>
    </header>
  );
}

const tab =
  "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-medium text-ink-muted";
const tabActive = "text-accent";

/** Mobile bottom tab bar (dev doc §11.1): Calendar · Printers · New · Settings. */
export function TabBar() {
  const editor = useEditor();
  return (
    <nav
      aria-label="Main"
      className="glass-strong fixed inset-x-0 bottom-0 z-10 flex items-stretch gap-1 rounded-t-2xl border-x-0 border-b-0 px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
      style={{ minHeight: "var(--tabbar-height)" }}
      data-testid="tab-bar"
    >
      <NavLink to="/" end className={({ isActive }) => `${tab} ${isActive ? tabActive : ""}`}>
        <CalendarIcon /> Calendar
      </NavLink>
      <NavLink to="/printers" className={({ isActive }) => `${tab} ${isActive ? tabActive : ""}`}>
        <PrinterIcon /> Printers
      </NavLink>
      <button
        type="button"
        className={`${tab} text-accent`}
        onClick={() => editor.openCreate()}
        data-testid="new-slot"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-on-accent">
          <PlusIcon size={18} />
        </span>
        New
      </button>
      <NavLink to="/settings" className={({ isActive }) => `${tab} ${isActive ? tabActive : ""}`}>
        <SettingsIcon /> Settings
      </NavLink>
    </nav>
  );
}
