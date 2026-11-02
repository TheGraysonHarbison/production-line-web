import { expect, type Locator } from "@playwright/test";

/** The editor's time fields are hour + minute selects (5-minute grid); `hhmm` is "HH:MM". */
export async function setTime(dialog: Locator, label: string, hhmm: string) {
  const [h, m] = hhmm.split(":");
  await dialog.getByLabel(`${label} hour`).selectOption(h as string);
  await dialog.getByLabel(`${label} minute`).selectOption(m as string);
}

/** Asserts the field's "HH:MM" value (the group carries it as `data-time`). */
export async function expectTime(dialog: Locator, label: string, hhmm: string) {
  await expect(dialog.getByRole("group", { name: label })).toHaveAttribute("data-time", hhmm);
}

export async function readTime(dialog: Locator, label: string): Promise<string> {
  return (await dialog.getByRole("group", { name: label }).getAttribute("data-time")) ?? "";
}
