import { expect, test } from "@playwright/test";

/** Runs once before the viewport projects: a fresh install becomes an owned install. */
test("fresh install redirects to /setup and creates the Owner", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: /create the owner account/i })).toBeVisible();
  await expect(page.getByTestId("detected-timezone")).not.toBeEmpty();

  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password").fill("ownerpass1");
  await page.getByRole("button", { name: "Create Owner" }).click();

  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByTestId("current-username")).toHaveText("owner");

  // Setup is now closed.
  await page.goto("/setup");
  await expect(page).not.toHaveURL(/\/setup$/);
});
