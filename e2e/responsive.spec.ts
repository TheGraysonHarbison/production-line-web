import { expect, type Page, test } from "@playwright/test";

const suffix = () => Math.random().toString(36).slice(2, 8);

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

/** Tomorrow's date in the app timezone, so "today" boundaries never bite. */
async function tomorrow(page: Page) {
  const meta = await (await page.request.get("/api/meta")).json();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: meta.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + 24 * 3_600_000));
}

/**
 * Dev doc §11.1: every control is at least 44×44 on touch layouts. Timeline cards and resize
 * handles encode time in their size and opt out with `data-geometry`; a checkbox's target is its
 * label.
 */
async function settleAnimations(page: Page) {
  // allSettled: a transition that is replaced before it ends rejects `finished` with AbortError.
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
}

async function auditTapTargets(page: Page, where: string) {
  // The glass entrance animation scales surfaces to 98.5% for 180ms; measure after it ends.
  await settleAnimations(page);
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [role="button"]',
    );
    for (const el of controls) {
      if (el.dataset.geometry) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      const target = el.matches('input[type="checkbox"], input[type="radio"]')
        ? (el.closest("label") ?? el)
        : el;
      const t = target.getBoundingClientRect();
      if (t.width < 44 || t.height < 44) {
        const name = (target.getAttribute("aria-label") ?? target.textContent ?? "")
          .trim()
          .slice(0, 40);
        out.push(
          `${target.tagName.toLowerCase()} "${name}" ${Math.round(t.width)}×${Math.round(t.height)}`,
        );
      }
    }
    return out;
  });
  expect(small, `tap targets under 44px on ${where}`).toEqual([]);
}

test.describe("touch layouts", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, "tablet and mobile only");

  test("tap-target audit across the app", async ({ page, baseURL, isMobile }) => {
    await signInAsOwner(page);
    const printer = await addPrinter(page, `Tap-${suffix()}`, baseURL as string);
    const date = await tomorrow(page);

    await page.goto("/");
    await expect(page.getByTestId("calendar")).toBeVisible();
    await auditTapTargets(page, "calendar");

    await page.goto(`/day/${date}`);
    await expect(page.getByTestId("timeline")).toBeVisible();
    await auditTapTargets(page, "day");

    await page.getByTestId("new-slot").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New slot" })).toBeVisible();
    await expect(dialog.getByLabel(printer.name)).toBeVisible();
    await auditTapTargets(page, "editor");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    if (isMobile) {
      await page.goto("/printers");
      await expect(page.getByTestId("dock-printers")).toContainText(printer.name);
      await auditTapTargets(page, "printers tab");
    } else {
      await page.getByTestId("open-printers").click();
      await expect(page.getByTestId("printers-drawer")).toBeVisible();
      await auditTapTargets(page, "printers drawer");
      await page.keyboard.press("Escape");
    }

    for (const path of [
      "/settings/profile",
      "/settings/printers",
      "/settings/general",
      "/settings/home-assistant",
      "/settings/users",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("navigation", { name: "Settings" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
      await auditTapTargets(page, path);
    }
  });

  test("mobile: tab bar, full-screen editor sheet, vertical timeline, tap-to-book", async ({
    page,
    baseURL,
    isMobile,
    viewport,
  }) => {
    test.skip(!isMobile, "mobile only");
    await signInAsOwner(page);
    const printer = await addPrinter(page, `Phone-${suffix()}`, baseURL as string);
    const date = await tomorrow(page);

    // Bottom tab bar navigation: Calendar · Printers · New · Settings.
    await page.goto("/");
    const tabs = page.getByTestId("tab-bar");
    await expect(tabs).toBeVisible();
    await expect(page.getByTestId("rail")).toHaveCount(0);
    await tabs.getByRole("link", { name: "Printers" }).click();
    await expect(page).toHaveURL(/\/printers$/);
    await expect(page.getByTestId("dock-printers")).toContainText(printer.name);
    await tabs.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await tabs.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("calendar")).toBeVisible();

    // "New" opens the editor as a full-screen sheet.
    await page.getByTestId("new-slot").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("data-sheet", "true");
    await settleAnimations(page);
    const box = (await dialog.boundingBox()) as { width: number; height: number };
    expect(box.width).toBe(viewport?.width);
    expect(box.height).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 1);
    const name = `Sheet-${suffix()}`;
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Start", { exact: true }).fill(date);
    await dialog.getByLabel("Start time").fill("09:00");
    await dialog.getByLabel("End", { exact: true }).fill(date);
    await dialog.getByLabel("End time").fill("10:00");
    await dialog.getByLabel(printer.name).check();
    await dialog.getByRole("button", { name: "Create slot" }).click();
    await expect(dialog).toBeHidden();

    // The day view is a vertical, scrolling timeline; the card is there and editable.
    await page.goto(`/day/${date}`);
    const timeline = page.getByTestId("timeline");
    await expect(timeline).toHaveAttribute("data-orientation", "vertical");
    const card = page.getByTestId("slot-card").filter({ hasText: name });
    await expect(card).toBeVisible();
    await card.click();
    await expect(dialog.getByRole("heading", { name: "Edit slot" })).toBeVisible();
    await expect(dialog.getByLabel("Start time")).toHaveValue("09:00");
    await dialog.getByLabel("Name").fill(`${name}-v2`);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("slot-card").filter({ hasText: `${name}-v2` })).toBeVisible();

    // Tap equivalent of drag-to-create: a tap on free lane space books an hour there.
    const track = page
      .locator(`[data-testid="lane-body"][data-printer-id="${printer.id}"]`)
      .getByTestId("lane-track");
    // The strip spans many days: pick tomorrow's 3 AM tick and bring it into the scroller's view.
    const tick = page
      .locator(`[data-testid="tick"][data-date="${date}"]`)
      .filter({ hasText: /^3 AM$/ })
      .first();
    await tick.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const tickTop = await tick.evaluate((el) => Number.parseFloat((el as HTMLElement).style.top));
    const trackBox = (await track.boundingBox()) as { x: number; y: number; width: number };
    // 3px past the tick is ~2 minutes, which floor-snaps to the hour.
    await page.touchscreen.tap(trackBox.x + trackBox.width / 2, trackBox.y + tickTop + 3);
    await expect(dialog.getByRole("heading", { name: "New slot" })).toBeVisible();
    await expect(dialog.getByLabel("Start time")).toHaveValue("03:00");
    await expect(dialog.getByLabel("End time")).toHaveValue("04:00");
    await expect(dialog.getByLabel(printer.name)).toBeChecked();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // Tapping a printer's column header also books it.
    await page.getByRole("button", { name: `Book ${printer.name}` }).click();
    await expect(dialog.getByRole("heading", { name: "New slot" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("tablet: icon rail, printer drawer, horizontal timeline", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "tablet only");
    await signInAsOwner(page);
    const printer = await addPrinter(page, `Tab-${suffix()}`, baseURL as string);
    const date = await tomorrow(page);

    await page.goto("/");
    await expect(page.getByTestId("rail")).toBeVisible();
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);
    // The printer list is not on screen until the drawer opens.
    await expect(page.getByTestId("dock-printers")).toHaveCount(0);
    await page.getByTestId("open-printers").click();
    const drawer = page.getByTestId("printers-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("dock-printers")).toContainText(printer.name);
    await expect(
      drawer
        .getByText(printer.name, { exact: true })
        .locator("..")
        .getByTestId("printer-availability"),
    ).toHaveText("Free today");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    // Booking from the drawer opens the editor (a centered dialog here) and closes the drawer.
    await page.getByTestId("open-printers").click();
    await drawer.getByRole("button", { name: `Book ${printer.name}` }).click();
    const dialog = page.getByTestId("slot-editor");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("data-sheet", "false");
    await expect(drawer).toBeHidden();
    await expect(dialog.getByLabel(printer.name)).toBeChecked();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    await page.goto(`/day/${date}`);
    await expect(page.getByTestId("timeline")).toHaveAttribute("data-orientation", "horizontal");
  });
});

test.describe("theme", () => {
  test("follows prefers-color-scheme and reduced motion; glass has a fallback", async ({
    page,
  }) => {
    await signInAsOwner(page);

    // Computed colors come back in oklch()/color-mix form; a canvas resolves them to sRGB bytes.
    const bodyRgb = () =>
      page.evaluate(() => {
        const css = getComputedStyle(document.body).backgroundColor;
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
      });
    const accent = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      );
    const varOf = (name: string) =>
      page.evaluate(
        (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
        name,
      );

    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
    await page.goto("/");
    await expect(page.getByTestId("calendar")).toBeVisible();
    for (const c of await bodyRgb()) expect(c).toBeGreaterThan(200);
    expect(await accent()).toBe(await varOf("--accent-l"));

    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    // Reduced motion shortens transitions to 0.01ms rather than removing them; let them finish.
    await settleAnimations(page);
    for (const c of await bodyRgb()) expect(c).toBeLessThan(80);
    expect(await accent()).toBe(await varOf("--accent-d"));
    // The accent/on-accent pair the chrome uses is derived with AA contrast in both schemes.
    expect(await varOf("--on-accent")).toBe(await varOf("--on-accent-d"));

    // Reduced motion: the glass entrance animation is off.
    await page.getByTestId("new-slot").click();
    const dialog = page.getByTestId("slot-editor");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    expect(await dialog.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain("blur(");

    // The solid fallback for browsers without backdrop-filter is shipped in the stylesheet.
    const hasFallback = await page.evaluate(() => {
      const walk = (rules: CSSRuleList): boolean =>
        Array.from(rules).some((r) => {
          if (
            r instanceof CSSSupportsRule &&
            /not/.test(r.conditionText) &&
            /backdrop-filter/.test(r.conditionText)
          ) {
            return true;
          }
          // @layer / @media / @supports blocks nest their rules.
          return "cssRules" in r ? walk((r as CSSGroupingRule).cssRules) : false;
        });
      return Array.from(document.styleSheets).some((sheet) => {
        try {
          return walk(sheet.cssRules);
        } catch {
          return false;
        }
      });
    });
    expect(hasFallback).toBe(true);
  });
});
