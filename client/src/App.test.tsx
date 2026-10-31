import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

type Route = { status: number; body: unknown };

function mockApi(routes: Record<string, Route>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://test").pathname;
    const route = routes[path] ?? { status: 404, body: { error: "not_found" } };
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { "content-type": "application/json" },
    });
  });
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const meta = (setup_required: boolean, registration_enabled = true) => ({
  status: 200,
  body: { setup_required, registration_enabled, images_enabled: false, timezone: "UTC" },
});
const unauthenticated = { status: 401, body: { error: "unauthorized" } };
const signedIn = {
  status: 200,
  body: {
    id: 1,
    username: "sam",
    color: "#4f9cff",
    role: "owner",
    avatar_url: null,
    time_format: "12h",
    created_at: "2026-01-01T00:00:00.000Z",
  },
};

describe("App routing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends a fresh install to the setup page", async () => {
    mockApi({ "/api/meta": meta(true), "/api/me": unauthenticated });
    renderAt("/");
    expect(
      await screen.findByRole("heading", { name: /create the owner account/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("detected-timezone").textContent).not.toBe("");
  });

  it("sends a signed-out visitor to the login page and offers registration", async () => {
    mockApi({ "/api/meta": meta(false), "/api/me": unauthenticated });
    renderAt("/settings/profile");
    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create an account/i })).toBeInTheDocument();
  });

  it("hides the registration link when registration is disabled", async () => {
    mockApi({ "/api/meta": meta(false, false), "/api/me": unauthenticated });
    renderAt("/login");
    await screen.findByRole("heading", { name: /sign in/i });
    expect(screen.queryByRole("link", { name: /create an account/i })).toBeNull();
  });

  it("routes a signed-in user to the profile page by URL", async () => {
    mockApi({ "/api/meta": meta(false), "/api/me": signedIn });
    renderAt("/settings/profile");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Time format")).toHaveValue("12h");
  });

  it("renders the shell with the initial-on-color avatar for a signed-in user", async () => {
    mockApi({
      "/api/meta": meta(false),
      "/api/me": {
        status: 200,
        body: {
          id: 1,
          username: "sam",
          color: "#4f9cff",
          role: "owner",
          avatar_url: null,
          time_format: "12h",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    renderAt("/");
    expect(await screen.findByText("Hello, sam")).toBeInTheDocument();
    const avatar = screen.getByRole("img", { name: "sam" });
    expect(avatar.textContent).toBe("s");
    expect(avatar).toHaveStyle({ backgroundColor: "#4f9cff" });
  });
});
