import type { PublicUser } from "@production-line/shared";
import { type FormEvent, useEffect, useState } from "react";
import { Avatar } from "../../components/Avatar.tsx";
import { buttonClass, inputClass } from "../../components/Field.tsx";
import { ErrorNotice, SuccessNotice } from "../../components/Notice.tsx";
import { useMe } from "../../lib/auth.tsx";
import { useSettings, useUpdateSettings, useUserMutations, useUsers } from "../../lib/data.ts";

const ERRORS = {
  wrong_password: "Your password was incorrect.",
  owner_immutable: "The Owner can't be changed.",
};

function UserRow({ user, isSelf }: { user: PublicUser; isSelf: boolean }) {
  const { setRole, remove, transfer } = useUserMutations();
  const [transferring, setTransferring] = useState(false);
  const [password, setPassword] = useState("");

  const submitTransfer = (e: FormEvent) => {
    e.preventDefault();
    transfer.mutate(
      { id: user.id, current_password: password },
      { onSuccess: () => setTransferring(false) },
    );
  };

  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
      data-testid="user-row"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Avatar user={user} size={28} />
        <span className="font-medium">{user.username}</span>
        <span
          className="rounded bg-neutral-200 px-2 py-0.5 text-xs dark:bg-neutral-800"
          data-testid={`role-${user.username}`}
        >
          {user.role}
        </span>
        {isSelf ? <span className="text-xs opacity-70">(you)</span> : null}
        {user.role !== "owner" ? (
          <div className="ml-auto flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              className="underline"
              onClick={() =>
                setRole.mutate({ id: user.id, role: user.role === "admin" ? "user" : "admin" })
              }
              disabled={setRole.isPending}
            >
              {user.role === "admin"
                ? `Revoke admin from ${user.username}`
                : `Make ${user.username} admin`}
            </button>
            <button type="button" className="underline" onClick={() => setTransferring((v) => !v)}>
              Transfer ownership to {user.username}
            </button>
            <button
              type="button"
              className="text-red-700 underline dark:text-red-400"
              onClick={() => {
                if (window.confirm(`Delete ${user.username} and all of their slots?`))
                  remove.mutate(user.id);
              }}
              disabled={remove.isPending}
            >
              Delete {user.username}
            </button>
          </div>
        ) : null}
      </div>
      {transferring ? (
        <form onSubmit={submitTransfer} className="flex flex-wrap items-center gap-2">
          <label htmlFor={`transfer-pw-${user.id}`} className="text-sm">
            Confirm your password to make {user.username} the Owner:
          </label>
          <input
            id={`transfer-pw-${user.id}`}
            type="password"
            className={inputClass}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit" className={buttonClass} disabled={transfer.isPending || !password}>
            Transfer
          </button>
        </form>
      ) : null}
      <ErrorNotice error={setRole.error ?? remove.error ?? transfer.error} map={ERRORS} />
    </li>
  );
}

export function UsersPage() {
  const me = useMe();
  const users = useUsers();
  const settings = useSettings();
  const update = useUpdateSettings();
  const [saved, setSaved] = useState<string | null>(null);
  // Local state so the checkbox flips synchronously on click; the server result follows.
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  useEffect(() => {
    if (settings.data) setRegistrationEnabled(settings.data.registration_enabled);
  }, [settings.data]);

  return (
    <section className="flex flex-col gap-6">
      <h2 className="font-semibold text-2xl">Users</h2>
      <SuccessNotice message={saved} />
      <ErrorNotice error={update.error} />
      {settings.data ? (
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={registrationEnabled}
            onChange={(e) => {
              const next = e.target.checked;
              setRegistrationEnabled(next);
              setSaved(null);
              update.mutate(
                { registration_enabled: next },
                {
                  onSuccess: (s) =>
                    setSaved(
                      s.registration_enabled ? "Registration is open." : "Registration is closed.",
                    ),
                  onError: () => setRegistrationEnabled(!next),
                },
              );
            }}
            disabled={update.isPending}
          />
          <span>
            <span className="font-medium">Allow new registrations</span>
            <span className="block text-sm opacity-70">
              When off, the sign-in page no longer offers an account link.
            </span>
          </span>
        </label>
      ) : null}
      {users.isPending ? <p className="text-sm opacity-70">Loading…</p> : null}
      <ul className="flex flex-col gap-2">
        {users.data?.map((u) => (
          <UserRow key={u.id} user={u} isSelf={u.id === me.data?.id} />
        ))}
      </ul>
    </section>
  );
}
