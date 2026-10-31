import type { Me, TimeFormat } from "@production-line/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { buttonClass, Field, inputClass } from "../components/Field.tsx";
import { ApiError, api } from "../lib/api.ts";
import { meQueryKey, useMe } from "../lib/auth.tsx";

export function ProfilePage() {
  const me = useMe();
  const qc = useQueryClient();
  const [color, setColor] = useState("#4f9cff");
  const [timeFormat, setTimeFormat] = useState<TimeFormat>("12h");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (me.data) {
      setColor(me.data.color);
      setTimeFormat(me.data.time_format);
    }
  }, [me.data]);

  const prefs = useMutation({
    mutationFn: () =>
      api<Me>("/api/me", { method: "PATCH", body: { color, time_format: timeFormat } }),
    onSuccess: (updated) => {
      qc.setQueryData(meQueryKey, updated);
      setSaved("Preferences saved.");
    },
  });

  const password = useMutation({
    mutationFn: () =>
      api<Me>("/api/me", {
        method: "PATCH",
        body: { password: newPassword, current_password: currentPassword },
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setSaved("Password changed. Other devices were signed out.");
    },
  });

  const pwErr = password.error instanceof ApiError ? password.error : null;
  const pwMessage =
    pwErr?.code === "wrong_password"
      ? "Current password is incorrect."
      : (pwErr?.fieldMessage("password") ?? pwErr?.message);

  if (!me.data) return null;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8">
      <h2 className="font-semibold text-2xl">Profile</h2>
      {saved ? (
        <p
          className="rounded-md bg-green-100 px-3 py-2 text-green-900 text-sm dark:bg-green-900 dark:text-green-100"
          role="status"
        >
          {saved}
        </p>
      ) : null}

      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setSaved(null);
          prefs.mutate();
        }}
      >
        <h3 className="font-medium text-lg">Preferences</h3>
        <Field label="Your color" htmlFor="color">
          <input
            id="color"
            type="color"
            className="h-10 w-20 cursor-pointer rounded-md"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </Field>
        <Field label="Time format" htmlFor="time_format">
          <select
            id="time_format"
            className={inputClass}
            value={timeFormat}
            onChange={(e) => setTimeFormat(e.target.value as TimeFormat)}
          >
            <option value="12h">12-hour (1:30 PM)</option>
            <option value="24h">24-hour (13:30)</option>
          </select>
        </Field>
        <button type="submit" className={buttonClass} disabled={prefs.isPending}>
          Save preferences
        </button>
      </form>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setSaved(null);
          password.mutate();
        }}
        noValidate
      >
        <h3 className="font-medium text-lg">Change password</h3>
        <Field label="Current password" htmlFor="current_password">
          <input
            id="current_password"
            type="password"
            className={inputClass}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </Field>
        <Field
          label="New password"
          htmlFor="new_password"
          hint="At least 8 characters"
          error={pwMessage}
        >
          <input
            id="new_password"
            type="password"
            className={inputClass}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </Field>
        <button
          type="submit"
          className={buttonClass}
          disabled={password.isPending || !currentPassword || !newPassword}
        >
          Change password
        </button>
      </form>
    </main>
  );
}
