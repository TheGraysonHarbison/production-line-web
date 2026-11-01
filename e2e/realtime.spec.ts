import { expect, type Page, test } from "@playwright/test";

const suffix = () => Math.random().toString(36).slice(2, 8);

async function register(page: Page, username: string) {
  await page.goto("/register");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("userpass1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("current-username")).toHaveText(username);
}

/** The printer list lives in the dock (desktop), a drawer (tablet), or the Printers tab (mobile). */
async function showPrinters(page: Page) {
  const width = await page.evaluate(() => window.innerWidth);
  if (width >= 1024) return;
  if (width >= 768) {
    await page.getByTestId("open-printers").click();
    return;
  }
  await page.goto("/printers");
}

async function signInAsOwner(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password").fill("ownerpass1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-username")).toHaveText("owner");
}

test("changes made in one browser appear live in another, without a reload", async ({
  page,
  browser,
  baseURL,
}) => {
  const watcherName = `watch-${suffix()}`;
  const watcher = await (await browser.newContext()).newPage();
  await register(watcher, watcherName);
  await expect(watcher.getByTestId("stream-status")).toHaveAttribute("data-status", "live");

  await signInAsOwner(page);
  await expect(page.getByTestId("stream-status")).toHaveAttribute("data-status", "live");

  // A printer created in the owner's browser shows up in the watcher's dock.
  const printerName = `Live-${suffix()}`;
  await page.goto("/settings/printers");
  await page.getByLabel("Printer name").fill(printerName);
  await page.getByRole("button", { name: "Add printer" }).click();
  await showPrinters(watcher);
  await expect(watcher.getByTestId("dock-printers")).toContainText(printerName);

  // A slot created through the API (no browser involved) shows up in both.
  const printers = await page.request.get("/api/printers");
  const printer = (await printers.json()).find((p: { name: string }) => p.name === printerName);
  const start = new Date(Math.ceil((Date.now() + 3_600_000) / 300_000) * 300_000);
  const end = new Date(start.getTime() + 3_600_000);
  const slotName = `Benchy-${suffix()}`;
  const created = await page.request.post("/api/slots", {
    headers: { origin: baseURL as string },
    data: {
      name: slotName,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      printer_ids: [printer.id],
    },
  });
  expect(created.status()).toBe(201);
  const meta = await (await page.request.get("/api/meta")).json();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: meta.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(start);
  await page.goto(`/day/${date}`);
  await watcher.goto(`/day/${date}`);
  await expect(page.getByTestId("slot-card").filter({ hasText: slotName })).toBeVisible();
  await expect(watcher.getByTestId("slot-card").filter({ hasText: slotName })).toBeVisible();

  // Deleting it via the API removes it live from the watcher.
  const slot = await created.json();
  const deleted = await page.request.delete(`/api/slots/${slot.id}`, {
    headers: { origin: baseURL as string },
  });
  expect(deleted.status()).toBe(204);
  await expect(watcher.getByTestId("slot-card").filter({ hasText: slotName })).toHaveCount(0);
  await expect(page.getByTestId("slot-card").filter({ hasText: slotName })).toHaveCount(0);

  await watcher.context().close();
});
