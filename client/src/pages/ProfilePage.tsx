import { IMAGE_ACCEPT, IMAGE_MAX_BYTES, type Me, type TimeFormat } from "@production-line/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Avatar } from "../components/Avatar.tsx";
import { buttonClass, Field, inputClass, secondaryButtonClass } from "../components/Field.tsx";
import { ErrorNotice, SuccessNotice } from "../components/Notice.tsx";
import { ApiError, api } from "../lib/api.ts";
import { meQueryKey, useMe, useMeta } from "../lib/auth.tsx";
import { uploadFile } from "../lib/upload.ts";
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

  const meta = useMeta();
  const [avatarProgress, setAvatarProgress] = useState<number | null>(null);
  const avatar = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > IMAGE_MAX_BYTES) {
        throw new ApiError(413, { error: "image_too_large", message: "Larger than 10 MB." });
      }
      setAvatarProgress(0);
      return uploadFile<Me>("/api/me/avatar", "PUT", file, { onProgress: setAvatarProgress });
    },
    onSuccess: (updated) => {
      qc.setQueryData(meQueryKey, updated);
      setSaved("Profile image updated.");
    },
    onSettled: () => setAvatarProgress(null),
  });
  const removeAvatar = useMutation({
    mutationFn: () => api<Me>("/api/me/avatar", { method: "DELETE" }),
    onSuccess: (updated) => {
      qc.setQueryData(meQueryKey, updated);
      setSaved("Profile image removed.");
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
        <section
          className="flex flex-col gap-4"
          aria-labelledby="avatar-title"
          data-testid="avatar-section"
        >
          <h4 id="avatar-title" className="font-medium">
            Profile image
          </h4>
          <ErrorNotice
            error={avatar.error ?? removeAvatar.error}
            map={{
              image_type_not_allowed:
                "Not a supported image (PNG, JPEG, TIFF, WEBP, or camera RAW).",
              image_too_large: "Larger than 10 MB.",
              images_disabled: "Image uploads are turned off.",
            }}
          />
          <div className="flex flex-wrap items-center gap-4">
            <Avatar user={me.data} size={64} />
            {meta.data?.images_enabled ? (
              <>
                <input
                  id="avatar-input"
                  type="file"
                  accept={IMAGE_ACCEPT}
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) avatar.mutate(file);
                    e.target.value = "";
                  }}
                  data-testid="avatar-upload"
                />
                <label htmlFor="avatar-input" className={`${secondaryButtonClass} cursor-pointer`}>
                  {me.data.avatar_url ? "Replace image" : "Upload image"}
                </label>
                {avatarProgress !== null ? (
                  <progress
                    className="h-2 w-32"
                    value={avatarProgress}
                    max={1}
                    aria-label="Uploading"
                  />
                ) : null}
              </>
            ) : (
              <span className="text-ink-muted text-sm">
                Image uploads are off. An admin can enable them under Settings → General.
              </span>
            )}
            {me.data.avatar_url ? (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => removeAvatar.mutate()}
                disabled={removeAvatar.isPending}
              >
                Remove image
              </button>
            ) : null}
          </div>
          <p className="text-ink-muted text-sm">
            Shown instead of your initial. PNG, JPEG, or WEBP display best; up to 10 MB.
          </p>
        </section>
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
