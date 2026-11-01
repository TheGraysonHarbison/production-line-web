import { expect, type Page, test } from "@playwright/test";

const suffix = () => Math.random().toString(36).slice(2, 8);
const PX_PER_MINUTE = 1.25;

async function signInAsOwner(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password").fill("ownerpass1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-username")).toHaveText("owner");
}

async function addPrinter(page: Page, name: string, baseURL: string) {
  const res = await page.request.post("/api/printers", {
    headers: { origin: baseURL },
    data: { name },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: number; name: string };
}

/** A clean window tomorrow (10:00–22:00 app time) so "today" boundaries never bite. */
async function tomorrowWindow(page: Page) {
  const meta = await (await page.request.get("/api/meta")).json();
  const tz: string = meta.timezone;
  const d = new Date(Date.now() + 24 * 3_600_000);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return { tz, date };
}

/**
 * Pixel x inside a lane track for a wall-clock time, read off the rendered hour ticks so DST days
 * (23/25 hours) work: `label` is a tick label like "10 AM", `plusMinutes` an offset from it.
 */
async function xFor(page: Page, trackBox: { x: number }, label: string, plusMinutes = 0) {
  const tick = page
    .getByTestId("tick")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first();
  const left = await tick.evaluate((el) => Number.parseFloat((el as HTMLElement).style.left));
  return trackBox.x + left + plusMinutes * PX_PER_MINUTE + 1;
}

test.describe("desktop scheduling", () => {
  test.skip(
    ({ isMobile, viewport }) => isMobile || (viewport?.width ?? 0) < 1024,
    "desktop pointer interactions; touch layouts are covered in responsive.spec.ts",
  );

  test("create by drag, edit, see a 409 surfaced, resize by drag, and delete", async ({
    page,
    browser,
    baseURL,
  }) => {
    await signInAsOwner(page);
    const printer = await addPrinter(page, `Drag-${suffix()}`, baseURL as string);
    const other = await addPrinter(page, `Other-${suffix()}`, baseURL as string);
    const { date } = await tomorrowWindow(page);

    // A second browser watches the same day.
    const watcher = await (await browser.newContext()).newPage();
    await watcher.goto("/register");
    await watcher.getByLabel("Username").fill(`w-${suffix()}`);
    await watcher.getByLabel("Password").fill("userpass1");
    await watcher.getByRole("button", { name: "Create account" }).click();
    await expect(watcher.getByTestId("current-username")).toBeVisible();
    await watcher.goto(`/day/${date}`);
    await expect(watcher.getByTestId("stream-status")).toHaveAttribute("data-status", "live");

    await page.goto(`/day/${date}`);
    const lane = page
      .getByTestId("lane")
      .filter({ has: page.getByText(printer.name, { exact: true }) });
    const track = lane.getByTestId("lane-track");
    // The dock settles its width after first paint, so measure right before each drag.
    const measure = async () => {
      await track.scrollIntoViewIfNeeded();
      await expect(page.getByTestId("dock-printers")).toContainText(printer.name);
      return (await track.boundingBox()) as { x: number; y: number; width: number; height: number };
    };
    let box = await measure();
    const y = box.y + box.height / 2;

    // Drag 06:00 → 08:00 on the printer's lane (morning hours fit inside the 1280px viewport).
    await page.mouse.move(await xFor(page, box, "6 AM"), y);
    await page.mouse.down();
    await page.mouse.move(await xFor(page, box, "7 AM"), y, { steps: 4 });
    await page.mouse.move(await xFor(page, box, "8 AM"), y, { steps: 4 });
    await page.mouse.up();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "New slot" })).toBeVisible();
    await expect(dialog.getByLabel("Start time")).toHaveValue("06:00");
    await expect(dialog.getByLabel("End time")).toHaveValue("08:00");
    await expect(dialog.getByLabel(printer.name)).toBeChecked();
    const slotName = `Benchy-${suffix()}`;
    await dialog.getByLabel("Name").fill(slotName);
    await dialog.getByRole("button", { name: "Create slot" }).click();
    await expect(dialog).toBeHidden();

    const card = page.getByTestId("slot-card").filter({ hasText: slotName });
    await expect(card).toBeVisible();
    await expect(watcher.getByTestId("slot-card").filter({ hasText: slotName })).toBeVisible();

    // Edit: rename and add the other printer.
    await card.click();
    await expect(dialog.getByRole("heading", { name: "Edit slot" })).toBeVisible();
    await dialog.getByLabel("Name").fill(`${slotName}-v2`);
    await dialog.getByLabel(other.name).check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("slot-card").filter({ hasText: `${slotName}-v2` })).toHaveCount(
      2,
    );
    await expect(
      watcher.getByTestId("slot-card").filter({ hasText: `${slotName}-v2` }),
    ).toHaveCount(2);

    // Conflict surfaced: open a new slot overlapping, then have the API take the printer first.
    await page.getByRole("button", { name: `Book ${printer.name}` }).click();
    await expect(dialog.getByRole("heading", { name: "New slot" })).toBeVisible();
    await dialog.getByLabel("Name").fill("Clash");
    await dialog.getByLabel("Start time").fill("09:00");
    await dialog.getByLabel("End time").fill("10:00");
    const meta = await (await page.request.get("/api/meta")).json();
    const toIso = (time: string) => {
      // Build the instant for `date time` in the app timezone via the browser's Intl.
      return page.evaluate(
        ([d, t, tz]) => {
          const [h, m] = t.split(":").map(Number);
          const guess = Date.UTC(
            Number(d.slice(0, 4)),
            Number(d.slice(5, 7)) - 1,
            Number(d.slice(8, 10)),
            h,
            m,
          );
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            hour: "numeric",
            minute: "numeric",
            hour12: false,
            year: "numeric",
            month: "numeric",
            day: "numeric",
          }).formatToParts(new Date(guess));
          const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
          const local = Date.UTC(
            get("year"),
            get("month") - 1,
            get("day"),
            get("hour") % 24,
            get("minute"),
          );
          return new Date(guess - (local - guess)).toISOString();
        },
        [date, time, meta.timezone] as [string, string, string],
      );
    };
    const taken = await page.request.post("/api/slots", {
      headers: { origin: baseURL as string },
      data: {
        name: "Taken first",
        start_at: await toIso("09:00"),
        end_at: await toIso("10:00"),
        printer_ids: [printer.id],
      },
    });
    expect(taken.status()).toBe(201);
    await dialog.getByRole("button", { name: "Create slot" }).click();
    const alert = dialog.getByRole("alert");
    await expect(alert).toContainText(/already booked/i);
    await expect(alert).toContainText("Taken first");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // Resize by dragging the right edge of our slot from 08:00 to 08:30 (on the first lane).
    box = await measure();
    const handle = lane.getByTestId("resize-handle").first();
    const handleBox = (await handle.boundingBox()) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(await xFor(page, box, "8 AM", 15), y, { steps: 5 });
    await page.mouse.move(await xFor(page, box, "8 AM", 30), y, { steps: 5 });
    await page.mouse.up();
    await page
      .getByTestId("slot-card")
      .filter({ hasText: `${slotName}-v2` })
      .first()
      .click();
    await expect(dialog.getByLabel("End time")).toHaveValue("08:30");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // Drag the left edge from 06:00 to 05:30.
    box = await measure();
    const startHandle = lane.getByTestId("resize-start-handle").first();
    const sh = (await startHandle.boundingBox()) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    await page.mouse.move(sh.x + sh.width / 2, sh.y + sh.height / 2);
    await page.mouse.down();
    await page.mouse.move(await xFor(page, box, "5 AM", 45), y, { steps: 5 });
    await page.mouse.move(await xFor(page, box, "5 AM", 30), y, { steps: 5 });
    await page.mouse.up();
    const ourCard = page
      .getByTestId("slot-card")
      .filter({ hasText: `${slotName}-v2` })
      .first();
    await expect.poll(async () => (await ourCard.getAttribute("title")) ?? "").toMatch(/5:30/);
    await ourCard.click();
    await expect(dialog.getByLabel("Start time")).toHaveValue("05:30");
    await expect(dialog.getByLabel("End time")).toHaveValue("08:30");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // Drag the card body half an hour earlier: 05:30–08:30 → 05:00–08:00 (later would hit the
    // 09:00 booking and be refused). A plain click still opens it.
    box = await measure();
    const cb = (await ourCard.boundingBox()) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    const grabX = cb.x + cb.width / 2;
    await page.mouse.move(grabX, cb.y + cb.height / 2);
    await page.mouse.down();
    await page.mouse.move(grabX - 15 * PX_PER_MINUTE, y, { steps: 5 });
    await page.mouse.move(grabX - 30 * PX_PER_MINUTE, y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await ourCard.getAttribute("title")) ?? "").toMatch(/5:00 AM/);
    await ourCard.click();
    await expect(dialog.getByRole("heading", { name: "Edit slot" })).toBeVisible();
    await expect(dialog.getByLabel("Start time")).toHaveValue("05:00");
    await expect(dialog.getByLabel("End time")).toHaveValue("08:00");

    // Delete from the editor.
    await dialog.getByRole("button", { name: "Delete" }).click();
    await dialog.getByRole("button", { name: "Yes, delete" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("slot-card").filter({ hasText: `${slotName}-v2` })).toHaveCount(
      0,
    );
    await expect(
      watcher.getByTestId("slot-card").filter({ hasText: `${slotName}-v2` }),
    ).toHaveCount(0);
    await watcher.context().close();
  });

  test("a running slot has no start handle and cannot be dragged, but opens on click", async ({
    page,
    baseURL,
  }) => {
    await signInAsOwner(page);
    const printer = await addPrinter(page, `Run-${suffix()}`, baseURL as string);
    const floorNow = new Date(Math.floor(Date.now() / 300_000) * 300_000);
    const end = new Date(floorNow.getTime() + 30 * 60_000);
    const name = `Running-${suffix()}`;
    const created = await page.request.post("/api/slots", {
      headers: { origin: baseURL as string },
      data: {
        name,
        start_at: floorNow.toISOString(),
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
    }).format(floorNow);

    await page.goto(`/day/${date}`);
    const card = page.getByTestId("slot-card").filter({ hasText: name });
    await expect(card).toHaveAttribute("data-running", "true");
    await expect(page.getByTestId("now-line").first()).toBeVisible();
    const lane = page
      .getByTestId("lane")
      .filter({ has: page.getByText(printer.name, { exact: true }) });
    await expect(lane.getByTestId("resize-handle")).toHaveCount(1);
    await expect(lane.getByTestId("resize-start-handle")).toHaveCount(0);
    await card.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Start time")).toBeDisabled();
    const endTime = dialog.getByLabel("End time");
    const [h, m] = (await endTime.inputValue()).split(":").map(Number);
    const plus = new Date(Date.UTC(2000, 0, 1, h, m + 30));
    await endTime.fill(
      `${String(plus.getUTCHours()).padStart(2, "0")}:${String(plus.getUTCMinutes()).padStart(2, "0")}`,
    );
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    const detail = await (await page.request.get(`/api/slots/${(await created.json()).id}`)).json();
    expect(Date.parse(detail.end_at) - end.getTime()).toBe(30 * 60_000);
  });

  test("the month calendar shows a bar for the booking and opens the day", async ({
    page,
    baseURL,
  }) => {
    await signInAsOwner(page);
    const printer = await addPrinter(page, `Cal-${suffix()}`, baseURL as string);
    const { date } = await tomorrowWindow(page);
    const start = new Date(Date.now() + 24 * 3_600_000);
    start.setUTCMinutes(0, 0, 0);
    const res = await page.request.post("/api/slots", {
      headers: { origin: baseURL as string },
      data: {
        name: `Cal-${suffix()}`,
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + 3_600_000).toISOString(),
        printer_ids: [printer.id],
      },
    });
    expect(res.status()).toBe(201);
    await page.goto(`/?month=${date.slice(0, 7)}`);
    const day = page
      .getByTestId("calendar-day")
      .filter({ has: page.locator(`[data-date="${date}"]`) })
      .or(page.locator(`[data-date="${date}"]`));
    await expect(day.first()).toContainText("owner");
    await day.first().click();
    await expect(page).toHaveURL(new RegExp(`/day/${date}$`));
    await expect(page.getByTestId("timeline")).toBeVisible();
  });

  test("the editor is keyboard-operable with focus trapped in the dialog", async ({
    page,
    baseURL,
  }) => {
    await signInAsOwner(page);
    await addPrinter(page, `Key-${suffix()}`, baseURL as string);
    await page.goto("/");
    await page.getByTestId("new-slot").focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Focus starts inside the dialog and stays there while tabbing.
    for (let i = 0; i < 12; i++) {
      const inside = await page.evaluate(() => !!document.activeElement?.closest("dialog[open]"));
      expect(inside, `tab ${i}`).toBe(true);
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // Cards carry the owner's name, so color is never the only ownership cue.
    await expect(page.getByTestId("new-slot")).toBeFocused();
  });
});
