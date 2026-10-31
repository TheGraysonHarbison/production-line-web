import type { Me } from "@production-line/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { buttonClass, Field, inputClass } from "../components/Field.tsx";
import { ApiError, api } from "../lib/api.ts";
import { meQueryKey, useMeta } from "../lib/auth.tsx";
import { AuthLayout } from "./AuthLayout.tsx";

export function RegisterPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meta = useMeta();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [color, setColor] = useState("#7c5cff");

  const register = useMutation({
    mutationFn: () =>
      api<Me>("/api/auth/register", {
        method: "POST",
        body: { username, password, favorite_color: color },
      }),
    onSuccess: (me) => {
      qc.setQueryData(meQueryKey, me);
      navigate("/", { replace: true });
    },
  });

  if (meta.data && !meta.data.registration_enabled) {
    return (
      <AuthLayout title="Registration is closed">
        <p className="text-sm opacity-80">Ask the Owner to enable registration, then try again.</p>
        <Link to="/login" className="underline">
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  const err = register.error instanceof ApiError ? register.error : null;
  const general =
    err?.code === "username_taken"
      ? "That username is already taken."
      : err?.code === "registration_disabled"
        ? "Registration is disabled."
        : err && !err.body.issues
          ? err.message
          : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    register.mutate();
  };

  return (
    <AuthLayout title="Create your account">
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
        <Field label="Your color" htmlFor="color" error={err?.fieldMessage("favorite_color")}>
          <input
            id="color"
            type="color"
            className="h-10 w-20 cursor-pointer rounded-md"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </Field>
        {general ? (
          <p className="text-red-600 text-sm dark:text-red-400" role="alert">
            {general}
          </p>
        ) : null}
        <button type="submit" className={buttonClass} disabled={register.isPending}>
          {register.isPending ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="text-sm">
        Already have an account?{" "}
        <Link to="/login" className="underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
