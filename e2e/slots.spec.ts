import { expect, type Page, test } from "@playwright/test";
import { expectTime, readTime, setTime } from "./editor-helpers.js";

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
 * Pixel x inside a lane track for a wall-clock time on `date`, read off the rendered hour ticks so
 * DST days (23/25 hours) work: `label` is a tick label like "10 AM", `plusMinutes` an offset from
 * it. The strip spans many days, so the tick is picked by its date as well as its label.
 */
async function xFor(
  page: Page,
  trackBox: { x: number },
  date: string,
  label: string,
  plusMinutes = 0,
) {
  const tick = page
    .locator(`[data-testid="tick"][data-date="${date}"]`)
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first();
  const left = await tick.evaluate((el) => Number.parseFloat((el as HTMLElement).style.left));
  return trackBox.x + left + plusMinutes * PX_PER_MINUTE + 1;
}

/** Waits for a smooth scroll (Next day, Now) to come to rest before measuring positions. */
async function settleScroll(page: Page) {
  const timeline = page.getByTestId("timeline");
  await expect
    .poll(async () => {
      const a = await timeline.evaluate((el) => el.scrollLeft + el.scrollTop);
      await new Promise((r) => setTimeout(r, 150));
      const b = await timeline.evaluate((el) => el.scrollLeft + el.scrollTop);
      return a === b;
    })
    .toBe(true);
}

/** The track's viewport box; its left edge is far off-screen once the strip is scrolled. */
async function trackBox(track: ReturnType<Page["getByTestId"]>) {
  return (await track.boundingBox()) as { x: number; y: number; width: number; height: number };
}

/**
 * A mouse drag along a lane. The suite runs in parallel against one server, and a printer
 * another test creates arrives live and can insert a lane above this one mid-drag, so the
 * vertical centre is re-read from the lane right before every pointer step.
 */
async function dragAlong(page: Page, track: ReturnType<Page["getByTestId"]>, xs: number[]) {
  const y = async () => {
    const b = await trackBox(track);
    return b.y + b.height / 2;
  };
  await page.mouse.move(xs[0] as number, await y());
  await page.mouse.down();
  for (const x of xs.slice(1)) await page.mouse.move(x, await y(), { steps: 4 });
  await page.mouse.up();
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
    const printer = await addPrinter(page, `Aa-drag-${suffix()}`, baseURL as string);
    const other = await addPrinter(page, `Ab-other-${suffix()}`, baseURL as string);
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
    // The strip opens scrolled to the requested day: its midnight marker is on screen and the
    // heading names it.
    await expect(
      page.locator(`[data-testid="tick"][data-date="${date}"][data-day-start]`),
    ).toBeInViewport();
    await expect(page.getByTestId("day-heading")).toHaveText(
      new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${date}T00:00:00Z`)),
    );
    const lane = page
      .getByTestId("lane")
      .filter({ has: page.getByText(printer.name, { exact: true }) });
    const track = lane.getByTestId("lane-track");
    // The dock settles its width after first paint, so measure right before each drag.
    const measure = async () => {
      await expect(page.getByTestId("dock-printers")).toContainText(printer.name);
      return trackBox(track);
    };
    let box = await measure();

    // Drag 06:00 → 08:00 on the printer's lane (morning hours fit inside the 1280px viewport).
    await dragAlong(page, track, [
      await xFor(page, box, date, "6 AM"),
      await xFor(page, box, date, "7 AM"),
      await xFor(page, box, date, "8 AM"),
    ]);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "New slot" })).toBeVisible();
    await expectTime(dialog, "Start time", "06:00");
    await expectTime(dialog, "End time", "08:00");
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
    await setTime(dialog, "Start time", "09:00");
    await setTime(dialog, "End time", "10:00");
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
    await dragAlong(page, track, [
      handleBox.x + handleBox.width / 2,
      await xFor(page, box, date, "8 AM", 15),
      await xFor(page, box, date, "8 AM", 30),
    ]);
    await page
      .getByTestId("slot-card")
      .filter({ hasText: `${slotName}-v2` })
      .first()
      .click();
    await expectTime(dialog, "End time", "08:30");
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
    await dragAlong(page, track, [
      sh.x + sh.width / 2,
      await xFor(page, box, date, "5 AM", 45),
      await xFor(page, box, date, "5 AM", 30),
    ]);
    const ourCard = page
      .getByTestId("slot-card")
      .filter({ hasText: `${slotName}-v2` })
      .first();
    await expect.poll(async () => (await ourCard.getAttribute("title")) ?? "").toMatch(/5:30/);
    await ourCard.click();
    await expectTime(dialog, "Start time", "05:30");
    await expectTime(dialog, "End time", "08:30");
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
    await dragAlong(page, track, [grabX, grabX - 15 * PX_PER_MINUTE, grabX - 30 * PX_PER_MINUTE]);
    await expect.poll(async () => (await ourCard.getAttribute("title")) ?? "").toMatch(/5:00 AM/);
    await ourCard.click();
    await expect(dialog.getByRole("heading", { name: "Edit slot" })).toBeVisible();
    await expectTime(dialog, "Start time", "05:00");
    await expectTime(dialog, "End time", "08:00");

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
    // Today opens a little before now: the current-time line is on screen without scrolling.
    await expect(page.getByTestId("now-line").first()).toBeInViewport();
    const lane = page
      .getByTestId("lane")
      .filter({ has: page.getByText(printer.name, { exact: true }) });
    await expect(lane.getByTestId("resize-handle")).toHaveCount(1);
    await expect(lane.getByTestId("resize-start-handle")).toHaveCount(0);
    await card.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Start time hour")).toBeDisabled();
    await expect(dialog.getByLabel("Start time minute")).toBeDisabled();
    const [h, m] = (await readTime(dialog, "End time")).split(":").map(Number);
    const plus = new Date(Date.UTC(2000, 0, 1, h, (m ?? 0) + 30));
    await setTime(
      dialog,
      "End time",
      `${String(plus.getUTCHours()).padStart(2, "0")}:${String(plus.getUTCMinutes()).padStart(2, "0")}`,
    );
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    const detail = await (await page.request.get(`/api/slots/${(await created.json()).id}`)).json();
    expect(Date.parse(detail.end_at) - end.getTime()).toBe(30 * 60_000);
  });

  test("the strip scrolls across days, Now returns to the present, and drags stop at now", async ({
    page,
    baseURL,
  }) => {
    // Jumps honour reduced motion by scrolling instantly, which keeps positions deterministic.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInAsOwner(page);
    const printer = await addPrinter(page, `Clamp-${suffix()}`, baseURL as string);
    const meta = await (await page.request.get("/api/meta")).json();
    const dateOf = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: meta.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    const today = dateOf(new Date());
    await page.goto(`/day/${today}`);
    const nowLine = page.getByTestId("now-line").first();
    await expect(nowLine).toBeInViewport();
    const heading = page.getByTestId("day-heading");
    const todayText = await heading.textContent();

    // Next day scrolls the same strip to tomorrow's midnight marker; the heading follows.
    const tomorrow = dateOf(new Date(Date.now() + 24 * 3_600_000));
    await page.getByRole("button", { name: "Next day" }).click();
    await expect(
      page.locator(`[data-testid="tick"][data-date="${tomorrow}"][data-day-start]`),
    ).toBeInViewport();
    await expect(heading).not.toHaveText(todayText ?? "");
    // The jump puts the day start right after the pinned label column (160px), so the present is
    // now left of that column: under it or scrolled away. `toBeInViewport` would still count the
    // part hidden under the sticky labels, which bites in the last two hours before midnight.
    const timelineBox = (await page.getByTestId("timeline").boundingBox()) as { x: number };
    await expect
      .poll(async () => ((await nowLine.boundingBox()) as { x: number }).x)
      .toBeLessThan(timelineBox.x + 160);
    await expect(page).toHaveURL(new RegExp(`/day/${tomorrow}$`));
    await settleScroll(page);

    // The far end of the strip is the booking horizon; the last day there is hatched past it.
    const horizonDay = dateOf(new Date(Date.now() + 30 * 24 * 3_600_000));
    await page.getByTestId("timeline").evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(
      page.locator(`[data-testid="tick"][data-date="${horizonDay}"]`).last(),
    ).toBeInViewport();
    await expect(page.getByTestId("hatch-horizon").first()).toBeInViewport();

    // Now brings the present back on screen.
    await page.getByTestId("jump-now").click();
    await expect(nowLine).toBeInViewport();
    await expect(heading).toHaveText(todayText ?? "");
    await settleScroll(page);

    // A drag that starts 90 minutes ahead and is pulled back into the past stops at now.
    const lane = page
      .getByTestId("lane")
      .filter({ has: page.getByText(printer.name, { exact: true }) });
    const track = lane.getByTestId("lane-track");
    await expect(page.getByTestId("dock-printers")).toContainText(printer.name);
    const box = await trackBox(track);
    const nowLeft = await lane
      .getByTestId("now-line")
      .evaluate((el) => Number.parseFloat((el as HTMLElement).style.left));
    const before = Date.now();
    await dragAlong(page, track, [
      box.x + nowLeft + 90 * PX_PER_MINUTE,
      box.x + nowLeft - 30 * PX_PER_MINUTE,
      box.x + nowLeft - 90 * PX_PER_MINUTE,
    ]);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New slot" })).toBeVisible();
    const slotName = `Clamped-${suffix()}`;
    await dialog.getByLabel("Name").fill(slotName);
    await dialog.getByRole("button", { name: "Create slot" }).click();
    await expect(dialog).toBeHidden();
    const list = (await (
      await page.request.get(
        `/api/slots?from=${new Date(before - 3_600_000).toISOString()}&to=${new Date(
          before + 3 * 3_600_000,
        ).toISOString()}`,
      )
    ).json()) as { name: string; start_at: string; end_at: string }[];
    const made = list.find((s) => s.name === slotName);
    expect(made).toBeTruthy();
    const start = Date.parse(made?.start_at ?? "");
    // Clamped to the first 5-minute mark not yet past, never into the hatched past.
    expect(start).toBeGreaterThanOrEqual(Math.floor(before / 300_000) * 300_000);
    expect(start).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    expect(Date.parse(made?.end_at ?? "") - start).toBeGreaterThanOrEqual(80 * 60_000);

    // Pressing in the hatched past does nothing. (Now leaves 30 minutes of past on screen; further
    // left is the pinned printer label.)
    const b2 = await trackBox(track);
    await page.mouse.click(box.x + nowLeft - 20 * PX_PER_MINUTE, b2.y + b2.height / 2);
    await page.waitForTimeout(300);
    await expect(dialog).toBeHidden();
  });

  test("the dock lists upcoming slots, names each printer's occupant, and keeps Settings by the account", async ({
    page,
    baseURL,
  }) => {
    await signInAsOwner(page);
    const origin = baseURL as string;
    const busy = await addPrinter(page, `Ac-busy-${suffix()}`, origin);
    const idle = await addPrinter(page, `Ad-idle-${suffix()}`, origin);
    const floorNow = Math.floor(Date.now() / 300_000) * 300_000;
    const book = async (name: string, printerId: number, startMs: number, minutes: number) => {
      const res = await page.request.post("/api/slots", {
        headers: { origin },
        data: {
          name,
          start_at: new Date(startMs).toISOString(),
          end_at: new Date(startMs + minutes * 60_000).toISOString(),
          printer_ids: [printerId],
        },
      });
      expect(res.status()).toBe(201);
    };
    const tag = suffix();
    // Running now on the busy printer; two future bookings, the later one on the idle printer.
    await book(`Now-${tag}`, busy.id, floorNow, 20);
    await book(`Later-${tag}`, idle.id, floorNow + 5 * 24 * 3_600_000, 60);
    await book(`Soon-${tag}`, busy.id, floorNow + 2 * 24 * 3_600_000, 60);

    await page.goto("/");
    const dock = page.locator("aside");
    // Settings sits in the account block directly above the user row, not in the main nav.
    await expect(dock.getByRole("navigation", { name: "Main" }).getByText("Settings")).toHaveCount(
      0,
    );
    const account = dock.getByRole("navigation", { name: "Account" });
    await expect(account.getByRole("link", { name: "Settings" })).toBeVisible();
    const order = await dock.evaluate((el) => {
      const pick = (sel: string) => el.querySelector(sel) as HTMLElement | null;
      const items = [
        ["new", pick('[data-testid="new-slot"]')],
        ["upcoming", pick('[data-testid="upcoming-slots"]')],
        ["printers", pick('[data-testid="dock-printers"]')],
        ["settings", pick('nav[aria-label="Account"]')],
        ["user", pick('[data-testid="current-username"]')],
      ] as const;
      return items
        .filter(([, node]) => node)
        .sort((a, b) => (a[1] as HTMLElement).offsetTop - (b[1] as HTMLElement).offsetTop)
        .map(([key]) => key);
    });
    expect(order).toEqual(["new", "upcoming", "printers", "settings", "user"]);

    // Upcoming: soonest first, the running slot excluded, capped at five.
    const upcoming = dock.getByTestId("upcoming-slot");
    await expect(upcoming).not.toContainText([`Now-${tag}`]);
    const soonIndex = await upcoming
      .filter({ hasText: `Soon-${tag}` })
      .evaluate((el) =>
        Array.from(el.parentElement?.parentElement?.children ?? []).indexOf(
          el.parentElement as Element,
        ),
      );
    const laterIndex = await upcoming
      .filter({ hasText: `Later-${tag}` })
      .evaluate((el) =>
        Array.from(el.parentElement?.parentElement?.children ?? []).indexOf(
          el.parentElement as Element,
        ),
      );
    expect(soonIndex).toBeGreaterThanOrEqual(0);
    expect(laterIndex).toBeGreaterThan(soonIndex);
    expect(await upcoming.count()).toBeLessThanOrEqual(5);
    await expect(upcoming.filter({ hasText: `Soon-${tag}` })).toContainText("owner");
    await expect(upcoming.filter({ hasText: `Soon-${tag}` })).toContainText(busy.name);

    // The busy printer names the slot printing on it and its author; the idle one is free today.
    const busyRow = dock
      .getByTestId("dock-printers")
      .getByText(busy.name, { exact: true })
      .locator("..");
    await expect(busyRow.getByTestId("printer-availability")).toContainText("Busy until");
    await expect(busyRow.getByTestId("printer-occupant")).toContainText(`Now-${tag}`);
    await expect(busyRow.getByTestId("printer-occupant")).toContainText("owner");
    const idleRow = dock
      .getByTestId("dock-printers")
      .getByText(idle.name, { exact: true })
      .locator("..");
    await expect(idleRow.getByTestId("printer-availability")).toHaveText("Free today");
    await expect(idleRow.getByTestId("printer-occupant")).toHaveCount(0);

    // Both lists open the slot in the editor.
    await upcoming.filter({ hasText: `Soon-${tag}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Edit slot" })).toBeVisible();
    await expect(dialog.getByLabel("Name")).toHaveValue(`Soon-${tag}`);
    // Minute options are the twelve 5-minute marks.
    const minutes = await dialog
      .getByLabel("Start time minute")
      .locator("option")
      .evaluateAll((els) => els.map((o) => (o as HTMLOptionElement).value));
    expect(minutes).toEqual([
      "00",
      "05",
      "10",
      "15",
      "20",
      "25",
      "30",
      "35",
      "40",
      "45",
      "50",
      "55",
    ]);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await busyRow.getByTestId("printer-occupant").click();
    await expect(dialog.getByLabel("Name")).toHaveValue(`Now-${tag}`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
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
