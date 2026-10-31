import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useMe, useMeta } from "../lib/auth.tsx";

function Loading() {
  return (
    <p className="p-6 text-sm opacity-70" aria-busy="true">
      Loading…
    </p>
  );
}

/** Sends the visitor to /setup until an Owner exists, then to /login until signed in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const meta = useMeta();
  const me = useMe();
  const location = useLocation();
  if (meta.isPending || me.isPending) return <Loading />;
  if (meta.data?.setup_required) return <Navigate to="/setup" replace />;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Login/register: bounce signed-in users to the app, and everyone to /setup on first boot. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const meta = useMeta();
  const me = useMe();
  if (meta.isPending || me.isPending) return <Loading />;
  if (meta.data?.setup_required) return <Navigate to="/setup" replace />;
  if (me.data) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * /setup is only reachable while setup is required. Once it completes, the freshly created Owner
 * goes to their profile (the same destination SetupPage navigates to, so the two can't race) and
 * anyone else goes to sign in.
 */
export function SetupOnly({ children }: { children: ReactNode }) {
  const meta = useMeta();
  const me = useMe();
  if (meta.isPending || me.isPending) return <Loading />;
  if (meta.data && !meta.data.setup_required) {
    return <Navigate to={me.data ? "/settings/profile" : "/login"} replace />;
  }
  return <>{children}</>;
}
