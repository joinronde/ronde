import { expect, test } from "@playwright/test";
import { choose } from "./select";

const run = Date.now().toString(36);
const admin = { name: "Nora Notify", email: `nora-${run}@example.com`, password: "notify-password-123" };

test("an admin adds a connector, a meeting sends its notifications through it", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(admin.name);
  await page.getByLabel("Email", { exact: true }).fill(admin.email);
  await page.getByLabel("Password", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Workspace name").fill(`Notify ${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  await page.waitForURL(/\/w\/notify-/);
  const workspace = page.url();

  // Workspace settings: a signed webhook; its signing key is shown once
  await page.goto(`${workspace}/settings`);
  const connectors = page.locator("#connectors");
  await choose(page, connectors.getByLabel("Add a connector"), "webhook");
  await connectors.getByLabel("Name").fill("CI hook");
  await connectors.getByLabel("Receiving address (https)").fill("https://hooks.example.org/ronde");
  await connectors.getByRole("button", { name: "Save" }).click();
  await expect(connectors.getByText(/^whsec_/)).toBeVisible();
  await expect(connectors.getByText("CI hook")).toBeVisible();
  await expect(connectors.getByText("Not used yet")).toBeVisible();

  // A meeting starts from the suggested set
  await page.goto(`${workspace}/meetings/new`);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Name").fill("Release sync");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  // Sections and modules: the template's, kept as they are
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Create the meeting" }).click();
  await page.waitForURL(/\/m\/[^/]+\/control$/, { timeout: 120_000 });
  const meeting = page.url().replace(/\/control$/, "");
  await page.getByRole("button", { name: "Skip the tour" }).click();
  await page.goto(`${meeting}/settings`);
  await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "Notifications" }).click();
  const rules = page.locator(".notify-rules button[id^=nrEvent]");
  await page.getByRole("button", { name: "Suggested set for CI hook" }).click();
  await expect(rules).toHaveCount(4);
  await page.getByRole("button", { name: "Save the notifications" }).click();
  await expect(page.getByText("Notifications saved.")).toBeVisible();
  await page.reload();
  await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "Notifications" }).click();
  await expect(rules).toHaveCount(4);
  await expect(rules.first()).toHaveAttribute("data-value", "checkin.reminder");

  // General settings save by themselves; the accent colour applies to every page of the meeting
  await page.goto(`${meeting}/settings#general`);
  await page.getByLabel("Meeting name").fill("Release crew");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "Appearance" }).click();
  await page.locator("label", { hasText: "Ocean" }).click();
  await expect(page.getByRole("radio", { name: "Ocean" })).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "ocean");
  await page.goto(`${meeting}/settings#general`);
  await expect(page.getByLabel("Meeting name")).toHaveValue("Release crew");

  // A check-in reminder rule exists: the control room offers to nudge the team
  await page.goto(`${meeting}/control`);
  await expect(page.getByRole("button", { name: "Send a reminder" })).toBeVisible();

  // The connector is now in use: it cannot be deleted
  await page.goto(`${workspace}/settings`);
  await expect(connectors.getByText("Used by 4 notifications")).toBeVisible();
});
