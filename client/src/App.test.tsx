import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("App", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the title and shows server meta", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          setup_required: true,
          registration_enabled: true,
          images_enabled: false,
          timezone: "Europe/Oslo",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    renderApp();
    expect(screen.getByRole("heading", { name: "Production Line" })).toBeInTheDocument();
    expect(await screen.findByText("Server timezone: Europe/Oslo")).toBeInTheDocument();
  });
});
