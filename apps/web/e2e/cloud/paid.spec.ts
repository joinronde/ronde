import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { setPlan } from "./plan";

// The paid features in a browser, on a cloud workspace moved to Enterprise: the logo, company domains and
// identity providers, custom roles, the audit log and its export, the portfolio dashboard and its export,
// insights and their report; then back on Community, each one says which plan brings it.

const run = Date.now().toString(36);
const who = { name: "Nora Lindqvist", email: `nora-${run}@example.com`, password: "paid-password-123" };
async function signUp(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(who.name);
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Workspace name").fill(`Paid ${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  await page.waitForURL(/\/w\/[^/]+$/);
  return new URL(page.url()).pathname;
}

test("an Enterprise workspace uses its paid features, and a Community one is told which plan brings them", async ({ page }) => {
  // Pages are compiled on their first visit by the dev server
  test.setTimeout(480_000);
  const base = await signUp(page);
  const slug = base.split("/")[2]!;
  await setPlan(slug, "enterprise");

  // Logo (Team): uploaded, then shown in the sidebar instead of Ronde's
  await page.goto(`${base}/settings`);
  await page.locator('.logo-settings input[type="file"]').setInputFiles(path.join(import.meta.dirname, "../../public/icon.png"));
  await expect(page.locator("img.side-ws-logo")).toBeVisible();

  // A CalDAV calendar account (Team): saved, then listed
  const calendars = page.locator(".calendar-accounts");
  await calendars.getByRole("button", { name: "Add a calendar account" }).click();
  await calendars.locator("#trKind").click();
  await page.getByRole("option", { name: "CalDAV" }).click();
  await calendars.getByLabel("CalDAV address").fill("https://caldav.example.com/dav/");
  await calendars.getByLabel("User name").fill(who.email);
  await calendars.getByLabel("Organizer of the events").fill(who.email);
  await calendars.getByLabel(/^Password/).fill("app-password");
  await calendars.getByRole("button", { name: "Save" }).click();
  await expect(calendars.locator(".tracker-list")).toContainText("CalDAV");

  // Company domain (Enterprise): added, with the DNS record that proves it
  await page.goto(`${base}/settings/security`);
  await page.getByLabel("Email domain").fill(`paid-${run}.example.com`);
  await page.getByRole("button", { name: "Add the domain" }).click();
  await expect(page.getByText(`_ronde-challenge.paid-${run}.example.com`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a provider" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a token" })).toBeVisible();

  // Custom role (Enterprise)
  await page.goto(`${base}/settings/roles`);
  await page.getByRole("button", { name: "New role" }).click();
  await page.getByLabel("Name").fill("Auditor");
  await page.getByRole("button", { name: "Save the role" }).click();
  await expect(page.getByText("Auditor")).toBeVisible();

  // Audit log (Team): what was just done, and its export
  await page.goto(`${base}/settings/audit`);
  for (const what of ["Role saved", "Domain added", "Logo changed"])
    await expect(page.getByRole("row", { name: new RegExp(what) })).toBeVisible();
  // Enterprise: streamed to a SIEM
  await expect(page.getByRole("heading", { name: "Stream to a SIEM" })).toBeVisible();
  const audit = await page.request.get(`/api/w/${slug}/audit`);
  expect(audit.status()).toBe(200);
  expect(audit.headers()["content-type"]).toMatch(/^text\/csv/);

  // Portfolio dashboard (Team), and its export
  await page.goto(`${base}/projects`);
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Name", { exact: true }).fill("Mobile app");
  await page.getByRole("button", { name: "Create the project" }).click();
  await page.waitForURL(/\/projects\/mobile-app$/);
  await page.goto(`${base}/projects?view=dashboard`);
  await expect(page.getByRole("tab", { name: "Dashboard" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Health week after week" })).toBeVisible();
  await expect(page.getByRole("table").getByText("Mobile app")).toBeVisible();
  await expect(page.getByRole("link", { name: "Export as CSV" })).toBeVisible();
  const csv = await page.request.get(`/api/w/${slug}/projects/export`);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("Mobile app");

  // Insights (Team), with their report by email
  await page.goto(`${base}/insights`);
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Report by email" })).toBeVisible();
  // Sent every week to the administrators
  await page.getByLabel("Every Monday (the week before)").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "✓" })).toBeVisible();

  // Back on Community: the paid pages say which plan brings them, and nothing paid can be done
  await setPlan(slug, "community");
  await page.goto(`${base}/insights`);
  await expect(page.locator(".plan-notice .plan-pill")).toContainText("Team");
  expect((await page.request.get(`/api/w/${slug}/projects/export`)).status()).toBe(403);
  expect((await page.request.get(`/api/w/${slug}/audit`)).status()).toBe(403);
});
