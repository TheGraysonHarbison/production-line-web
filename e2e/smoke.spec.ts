import { expect, test } from "@playwright/test";

test("app mounts and reaches the API", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Production Line" })).toBeVisible();
  await expect(page.getByTestId("meta-status")).toHaveText(/Server timezone: /);
});

test("unknown client routes fall back to the SPA", async ({ page }) => {
  await page.goto("/some/deep/link");
  await expect(page.getByRole("heading", { name: "Production Line" })).toBeVisible();
});
