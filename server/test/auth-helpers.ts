import type { Me } from "@production-line/shared";
import type { LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import { SESSION_COOKIE } from "../src/plugins/auth.js";
import type { TestApp } from "./helpers.js";

export const ORIGIN = "http://localhost:80";

export interface Session {
  cookie: string;
  me: Me;
}

/** Inject helper that adds the CSRF Origin header and an optional session cookie. */
export function request(
  t: TestApp,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  options: { body?: unknown; cookie?: string; origin?: string | null } = {},
) {
  const headers: Record<string, string> = {};
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.cookie) headers.cookie = options.cookie;
  return t.app.inject({
    method,
    url,
    headers,
    ...(options.body !== undefined ? { payload: options.body } : {}),
  });
}

export function sessionCookie(res: LightMyRequestResponse): string {
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!set) throw new Error("no session cookie in response");
  return `${SESSION_COOKIE}=${set.value}`;
}

export async function setupOwner(
  t: TestApp,
  username = "owner",
  password = "ownerpass1",
  timezone = "America/New_York",
): Promise<Session> {
  const res = await request(t, "POST", "/api/setup", {
    body: { username, password, favorite_color: "#112233", timezone },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { cookie: sessionCookie(res), me: res.json() };
}

export async function registerUser(
  t: TestApp,
  username: string,
  password = "userpass1",
): Promise<Session> {
  const res = await request(t, "POST", "/api/auth/register", {
    body: { username, password, favorite_color: "#445566" },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { cookie: sessionCookie(res), me: res.json() };
}

export async function login(t: TestApp, username: string, password: string): Promise<Session> {
  const res = await request(t, "POST", "/api/auth/login", { body: { username, password } });
  expect(res.statusCode, res.body).toBe(200);
  return { cookie: sessionCookie(res), me: res.json() };
}

/** Owner + one admin + one plain user, each signed in. */
export async function seedRoles(t: TestApp) {
  const owner = await setupOwner(t);
  const admin = await registerUser(t, "admin");
  const user = await registerUser(t, "user");
  const promote = await request(t, "PATCH", `/api/users/${admin.me.id}/role`, {
    body: { role: "admin" },
    cookie: owner.cookie,
  });
  expect(promote.statusCode, promote.body).toBe(200);
  return { owner, admin: { ...admin, me: promote.json() as Me }, user };
}
