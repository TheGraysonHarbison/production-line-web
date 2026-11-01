import type { Me, TimeFormat } from "@production-line/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Avatar } from "../components/Avatar.tsx";
import { buttonClass, Field, inputClass } from "../components/Field.tsx";
import { ErrorNotice, SuccessNotice } from "../components/Notice.tsx";
import { ApiError, api } from "../lib/api.ts";
import { meQueryKey, useMe } from "../lib/auth.tsx";
import { useTheme } from "../theme/theme.tsx";

export function ProfilePage() {
  const me = useMe();
  const qc = useQueryClient();
  const theme = useTheme();
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

  // Live preview (dev doc §11): the chrome follows the picker; leaving the page reverts it.
  const previewColor = me.data && color !== me.data.color ? color : null;
  const { setPreview } = theme;
  useEffect(() => {
    setPreview(previewColor);
    return () => setPreview(null);
  }, [previewColor, setPreview]);

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
  const p = theme.palette;

  return (
    <main className="flex flex-col gap-8">
      <h2 className="font-semibold text-2xl">Profile</h2>
      <SuccessNotice message={saved} />
      <ErrorNotice error={prefs.error} />

      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setSaved(null);
          prefs.mutate();
        }}
      >
        <h3 className="font-medium text-lg">Preferences</h3>
        <Field
          label="Your color"
          htmlFor="color"
          hint="Tints your slots everywhere and the app's chrome for you. The preview updates as you pick."
        >
          <div className="flex flex-wrap items-center gap-4">
            <input
              id="color"
              type="color"
              className="h-11 w-20 cursor-pointer rounded-lg border border-line-strong bg-transparent p-1"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
            <div className="flex items-center gap-3" data-testid="color-preview">
              <Avatar user={{ username: me.data.username, color, avatar_url: null }} size={40} />
              <span
                className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-sm"
                style={{ background: "var(--accent)", color: "var(--on-accent)" }}
              >
                Accent
              </span>
              <span
                className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm"
                style={{
                  background: "var(--accent-soft)",
                  borderColor: "var(--accent)",
                  color: "var(--ink)",
                }}
              >
                Soft
              </span>
              <span className="text-ink-muted text-xs">
                light {p.light.accent} · dark {p.dark.accent}
              </span>
            </div>
          </div>
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
        <div>
          <button type="submit" className={buttonClass} disabled={prefs.isPending}>
            Save preferences
          </button>
        </div>
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
        <div>
          <button
            type="submit"
            className={buttonClass}
            disabled={password.isPending || !currentPassword || !newPassword}
          >
            Change password
          </button>
        </div>
      </form>
    </main>
  );
}
