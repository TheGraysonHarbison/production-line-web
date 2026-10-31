import type { Me, Meta } from "@production-line/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { buttonClass, Field, inputClass } from "../components/Field.tsx";
import { ApiError, api } from "../lib/api.ts";
import { detectTimeZone, meQueryKey, metaQueryKey } from "../lib/auth.tsx";
import { AuthLayout } from "./AuthLayout.tsx";

export function SetupPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [color, setColor] = useState("#4f9cff");
  const timezone = detectTimeZone();

  const setup = useMutation({
    mutationFn: () =>
      api<Me>("/api/setup", {
        method: "POST",
        body: { username, password, favorite_color: color, timezone },
      }),
    onSuccess: (me) => {
      // Update both caches before navigating so neither guard bounces us: SetupOnly would send a
      // completed setup to "/", and RequireAuth would send a stale setup_required back to "/setup".
      qc.setQueryData(meQueryKey, me);
      qc.setQueryData<Meta>(metaQueryKey, (old) => (old ? { ...old, setup_required: false } : old));
      navigate("/settings/profile", { replace: true });
      void qc.invalidateQueries({ queryKey: metaQueryKey });
    },
  });

  const err = setup.error instanceof ApiError ? setup.error : null;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setup.mutate();
  };

  return (
    <AuthLayout title="Welcome! Create the Owner account">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Username" htmlFor="username" error={err?.fieldMessage("username")}>
          <input
            id="username"
            className={inputClass}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          error={err?.fieldMessage("password")}
          hint="At least 8 characters"
        >
          <input
            id="password"
            type="password"
            className={inputClass}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Field
          label="Your color"
          htmlFor="color"
          error={err?.fieldMessage("favorite_color")}
          hint="Tints your slots and the app for you"
        >
          <input
            id="color"
            type="color"
            className="h-10 w-20 cursor-pointer rounded-md"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </Field>
        <p className="text-sm opacity-70">
          Detected timezone: <span data-testid="detected-timezone">{timezone}</span>. Admins can
          change this later.
        </p>
        {err && !err.body.issues ? (
          <p className="text-red-600 text-sm dark:text-red-400" role="alert">
            {err.message}
          </p>
        ) : null}
        <button type="submit" className={buttonClass} disabled={setup.isPending}>
          {setup.isPending ? "Creating…" : "Create Owner"}
        </button>
      </form>
    </AuthLayout>
  );
}
