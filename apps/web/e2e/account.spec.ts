import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createWorkspace, png, signIn, signUp } from "./helpers";

// The account pages: profile, photo, theme, weekly summary, data export and deletion; then password and sessions

const run = Date.now().toString(36);

test("the profile, the photo, the theme, the weekly summary, the data export and the account deletion", async ({ page }) => {
  test.setTimeout(240_000);
  const who = { name: "Olga Owner", email: `olga-${run}@example.com`, password: "account-password-123" };
  await signUp(page, who);
  const workspace = await createWorkspace(page, `Account ${run}`);
  const slug = new URL(workspace).pathname.split("/")[2]!;

  // Name: saved by itself a moment after typing, shown in the header after a reload
  await page.goto("/account");
  await page.getByLabel("Name", { exact: true }).fill("Olga Petrova");
  await expect(page.getByRole("status").filter({ hasText: "✓ Saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Olga Petrova" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Olga Petrova");

  // Photo: cropped in the browser, sent, then shown in the account's header after a reload
  await page.locator('.account-photo input[type="file"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png() });
  await expect(page.getByRole("status").filter({ hasText: "✓ Photo saved" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".account-head-av img")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change the photo" })).toBeVisible();

  // Theme: applied at once, and kept by the server for the next page
  // The preview drawn over each radio is what people click
  await page.locator(".theme-option").filter({ hasText: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(async () => {
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark", { timeout: 1000 });
  }).toPass();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await page.locator(".theme-option").filter({ hasText: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("radio", { name: "Light" })).toBeChecked({ timeout: 1000 });
  }).toPass();

  // Weekly summary: on by default, turned off, still off after a reload
  await page.goto("/account/notifications");
  const weekly = page.getByRole("checkbox", { name: "Send me a summary of my week every Monday" });
  await expect(weekly).toBeChecked();
  await weekly.uncheck();
  await expect(async () => {
    await page.reload();
    await expect(weekly).not.toBeChecked({ timeout: 1000 });
  }).toPass();

  // Download my data: one JSON file with the account in it
  await page.goto("/account");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download my data" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.json$/);
  const data = JSON.parse(readFileSync((await file.path())!, "utf8"));
  expect(JSON.stringify(data)).toContain(who.email);

  // Deletion: the address must be typed, and the only owner of a workspace is stopped
  await page.getByRole("button", { name: "Delete my account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete my account" });
  const confirm = dialog.getByRole("button", { name: "Delete for good" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/^Type/).fill("someone-else@example.com");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/^Type/).fill(who.email);
  await confirm.click();
  await expect(dialog.getByText(`You are the only owner of Account ${run}`)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The workspace is deleted first, with its address typed to confirm
  await page.goto(`${workspace}/settings`);
  await page.getByRole("button", { name: "Delete the workspace" }).click();
  const remove = page.getByRole("dialog", { name: "Delete the workspace" });
  await expect(remove.getByRole("button", { name: "Delete the workspace" })).toBeDisabled();
  await remove.getByLabel(/^Type/).fill(slug);
  await remove.getByRole("button", { name: "Delete the workspace" }).click();
  // Back to the start page, which the dev server may compile first
  await page.waitForURL((url) => !url.pathname.endsWith("/settings"), { timeout: 60_000 });
  expect((await page.goto(workspace))?.status()).toBe(404);

  // Then the account goes: signed out, and the password no longer opens anything
  await page.goto("/account");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByRole("dialog", { name: "Delete my account" }).getByLabel(/^Type/).fill(who.email);
  await page.getByRole("dialog", { name: "Delete my account" }).getByRole("button", { name: "Delete for good" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
  await signIn(page, who.email, who.password);
  await expect(page.locator(".form-alert")).toHaveText("Wrong email or password.");
});

test("the password is changed, then signing out everywhere ends every session", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const who = { name: "Pavel Pass", email: `pavel-${run}@example.com`, password: "first-password-123" };
  await signUp(page, who);
  await expect(page).toHaveURL(/\/onboarding$/);

  // A second browser signed in to the same account
  const other = await (await browser.newContext({ locale: "en-US" })).newPage();
  await signIn(other, who.email, who.password);
  await expect(other).toHaveURL(/\/onboarding$/);

  // A wrong current password: refused
  await page.goto("/account/security");
  await page.getByLabel("Current password").fill("not-my-password-1");
  await page.getByLabel("New password", { exact: true }).fill("second-password-456");
  await page.getByLabel("New password, again").fill("second-password-456");
  await page.getByRole("button", { name: "Change the password" }).click();
  await expect(page.locator(".form-alert")).toHaveText("Wrong email or password.");

  // Changed: the other devices are signed out, this one stays
  await page.getByLabel("Current password").fill(who.password);
  await page.getByLabel("New password", { exact: true }).fill("second-password-456");
  await page.getByLabel("New password, again").fill("second-password-456");
  await page.getByRole("button", { name: "Change the password" }).click();
  await expect(page.getByText("Password changed. Your other devices were signed out.")).toBeVisible();
  await other.goto("/account");
  await expect(other).toHaveURL(/\/sign-in/);

  // The old password no longer works, the new one does
  await signIn(other, who.email, who.password);
  await expect(other.locator(".form-alert")).toHaveText("Wrong email or password.");
  await signIn(other, who.email, "second-password-456");
  await expect(other).toHaveURL(/\/onboarding$/);

  // Sign out everywhere: this browser and the other one are both out
  await page.reload();
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
  await other.goto("/account/security");
  await expect(other).toHaveURL(/\/sign-in/);
  await other.context().close();
});
