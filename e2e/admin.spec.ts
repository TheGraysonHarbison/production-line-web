import { expect, type Page, test } from "@playwright/test";

const suffix = () => Math.random().toString(36).slice(2, 8);

async function signInAsOwner(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password").fill("ownerpass1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-username")).toHaveText("owner");
}

test("admin adds, hides, renames, and deletes a printer, and changes the timezone", async ({
  page,
}) => {
  await signInAsOwner(page);
  const name = `Prusa-${suffix()}`;

  await page.goto("/settings/printers");
  await page.getByLabel("Printer name").fill(name);
  await page.getByRole("button", { name: "Add printer" }).click();
  const row = page.getByTestId("printer-row").filter({ hasText: name });
  await expect(row).toBeVisible();

  // Duplicate (case-insensitive) is refused with a message.
  await page.getByLabel("Printer name").fill(name.toLowerCase());
  await page.getByRole("button", { name: "Add printer" }).click();
  await expect(page.getByRole("alert")).toHaveText(/already exists/i);

  await row.getByRole("button", { name: `Hide ${name}` }).click();
  await expect(row.getByText("invisible")).toBeVisible();
  // Invisible printers are not listed on the home page.
  await page.goto("/");
  await expect(page.getByTestId("home-printers")).not.toContainText(name);

  await page.goto("/settings/printers");
  await row.getByRole("button", { name: `Show ${name}` }).click();
  await expect(row.getByText("invisible")).toHaveCount(0);
  await row.getByRole("button", { name: "Rename" }).click();
  await row.getByLabel(`Rename ${name}`).fill(`${name}-S`);
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("printer-row").filter({ hasText: `${name}-S` })).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: `Delete ${name}-S` }).click();
  await expect(page.getByTestId("printer-row").filter({ hasText: `${name}-S` })).toHaveCount(0);

  await page.goto("/settings/general");
  await page.getByLabel("Timezone").selectOption("Europe/Oslo");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText(/saved/i);
  await page.reload();
  await expect(page.getByLabel("Timezone")).toHaveValue("Europe/Oslo");
});

test("owner toggles registration; a second browser sees the register link disappear after reload", async ({
  page,
  browser,
}) => {
  await signInAsOwner(page);
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/login");
  await expect(visitor.getByRole("link", { name: /create an account/i })).toBeVisible();

  await page.goto("/settings/users");
  const toggle = page.getByLabel("Allow new registrations");
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.getByRole("status")).toHaveText(/closed/i);

  await visitor.reload();
  await expect(visitor.getByRole("heading", { name: /sign in/i })).toBeVisible();
  await expect(visitor.getByRole("link", { name: /create an account/i })).toHaveCount(0);
  await visitor.goto("/register");
  await expect(visitor.getByRole("heading", { name: /registration is closed/i })).toBeVisible();

  await toggle.check();
  await expect(page.getByRole("status")).toHaveText(/open/i);
  await visitor.goto("/login");
  await expect(visitor.getByRole("link", { name: /create an account/i })).toBeVisible();
  await visitor.context().close();
});

test("owner promotes a user to admin; the admin sees admin tabs but not Users", async ({
  page,
  browser,
}) => {
  const username = `kim-${suffix()}`;
  const other = await (await browser.newContext()).newPage();
  await other.goto("/register");
  await other.getByLabel("Username").fill(username);
  await other.getByLabel("Password").fill("userpass1");
  await other.getByRole("button", { name: "Create account" }).click();
  await expect(other.getByTestId("current-username")).toHaveText(username);
  await other.goto("/settings/profile");
  await expect(other.getByRole("navigation", { name: "Settings" })).not.toContainText("Printers");

  await signInAsOwner(page);
  await page.goto("/settings/users");
  await page.getByRole("button", { name: `Make ${username} admin` }).click();
  await expect(page.getByTestId(`role-${username}`)).toHaveText("admin");

  await other.reload();
  const nav = other.getByRole("navigation", { name: "Settings" });
  await expect(nav).toContainText("Printers");
  await expect(nav).not.toContainText("Users");
  await other.goto("/settings/users");
  await expect(other).toHaveURL(/\/settings\/profile$/);
  await other.context().close();
});
