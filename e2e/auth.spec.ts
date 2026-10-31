import { expect, test } from "@playwright/test";

const suffix = () => Math.random().toString(36).slice(2, 8);

test("signed-out visitors land on the login page, even from deep links", async ({ page }) => {
  await page.goto("/settings/profile");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Production Line" })).toBeVisible();
});

test("a new person registers, signs out, and signs back in", async ({ page }) => {
  const username = `sam-${suffix()}`;
  await page.goto("/login");
  await page.getByRole("link", { name: /create an account/i }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("userpass1");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("current-username")).toHaveText(username);
  await expect(page.getByRole("img", { name: username })).toHaveText(username.charAt(0));

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText(/incorrect username or password/i);

  await page.getByLabel("Password").fill("userpass1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-username")).toHaveText(username);
});

test("profile page saves preferences", async ({ page }) => {
  const username = `pat-${suffix()}`;
  await page.goto("/register");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("userpass1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("current-username")).toHaveText(username);

  await page.goto("/settings/profile");
  await page.getByLabel("Time format").selectOption("24h");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("status")).toHaveText(/preferences saved/i);
});
