import type { Me } from "@production-line/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { buttonClass, Field, inputClass } from "../components/Field.tsx";
import { ApiError, api } from "../lib/api.ts";
import { meQueryKey, useMeta } from "../lib/auth.tsx";
import { AuthLayout } from "./AuthLayout.tsx";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const meta = useMeta();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => api<Me>("/api/auth/login", { method: "POST", body: { username, password } }),
    onSuccess: (me) => {
      qc.setQueryData(meQueryKey, me);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/login" ? from : "/", { replace: true });
    },
  });

  const err = login.error instanceof ApiError ? login.error : null;
  const message =
    err?.code === "invalid_credentials"
      ? "Incorrect username or password."
      : err?.code === "rate_limited"
        ? "Too many attempts. Try again in a minute."
        : err?.message;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <AuthLayout title="Sign in">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Username" htmlFor="username">
          <input
            id="username"
            className={inputClass}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <input
            id="password"
            type="password"
            className={inputClass}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {message ? (
          <p className="text-red-600 text-sm dark:text-red-400" role="alert">
            {message}
          </p>
        ) : null}
        <button type="submit" className={buttonClass} disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {meta.data?.registration_enabled ? (
        <p className="text-sm">
          New here?{" "}
          <Link to="/register" className="underline">
            Create an account
          </Link>
        </p>
      ) : null}
    </AuthLayout>
  );
}
