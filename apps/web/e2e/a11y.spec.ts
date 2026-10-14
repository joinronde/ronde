import { expect, test } from "@playwright/test";
import { audit } from "./axe";

// Accessibility audit (WCAG 2.1 AA rules of axe) of the main pages, in light and dark themes

const run = Date.now().toString(36);
const who = { name: "Alma Axe", email: `alma-${run}@example.com`, password: "audit-password-123" };

test("the main pages pass the accessibility audit", async ({ page }) => {
  // Every page is compiled on its first visit by the dev server: the audit takes a while
  test.setTimeout(480_000);
  await page.goto("/sign-in");
  await audit(page, "sign-in");
  await page.goto("/sign-up");
  await audit(page, "sign-up");
  await page.getByLabel("Full name").fill(who.name);
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Workspace name").waitFor();
  await audit(page, "onboarding");
  await page.getByLabel("Workspace name").fill(`Audit ${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  await page.waitForURL(/\/w\/audit-/);
  const workspace = page.url();
  await audit(page, "home");
  await page.goto(`${workspace}/people`);
  await audit(page, "directory");
  await page.goto(`${workspace}/settings`);
  await audit(page, "workspace settings");
  await page.goto(`${workspace}/projects`);
  await audit(page, "portfolio");
  await page.getByRole("button", { name: "New project" }).first().click();
  await audit(page, "new project");
  await page.getByLabel("Name", { exact: true }).fill("Audit project");
  await page.getByRole("button", { name: "Create the project" }).click();
  await page.waitForURL(/\/projects\/audit-project$/);
  await audit(page, "project");

  await page.goto(`${workspace}/meetings/new`);
  await audit(page, "wizard: template");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await audit(page, "wizard: details");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await audit(page, "wizard: sections and modules");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await audit(page, "wizard: review");
  await page.getByRole("button", { name: "Create the meeting" }).click();
  await page.waitForURL(/\/control$/);
  const meeting = page.url().replace(/\/control$/, "");
  await page.getByRole("button", { name: "Skip the tour" }).click();
  await audit(page, "control room");
  await page.keyboard.press("Control+k");
  await audit(page, "command palette");
  await page.keyboard.press("Escape");
  for (const category of [
    "general",
    "schedule",
    "people",
    "sections",
    "agenda",
    "projects",
    "modules",
    "appearance",
    "notifications",
    "template",
    "danger",
  ]) {
    await page.goto(`${meeting}/settings#${category}`);
    await page.reload();
    await audit(page, `settings: ${category}`);
  }
  await page.goto(`${meeting}/me`);
  await audit(page, "my screen");
  await page.goto(`${meeting}/history`);
  await audit(page, "history");
  await page.goto(`${meeting}/stats`);
  await audit(page, "stats");
  await page.goto(`${meeting}/decisions`);
  await audit(page, "decisions");
  await page.goto(`${workspace}/calendar`);
  await audit(page, "calendar");
  await page.goto(`${workspace}/actions`);
  await audit(page, "actions");
  await page.goto(`${workspace}/meetings`);
  await audit(page, "meetings");
  await page.goto(`${workspace}/templates`);
  await audit(page, "templates");
  await page.goto(`${workspace}/kudos`);
  await audit(page, "kudos");
  await page.goto(`${workspace}/decisions`);
  await audit(page, "decisions of the workspace");
  await page.goto(`${workspace}/people`);
  // A person's profile, from the directory's table (the tabs above it are links too)
  await page.getByRole("main").getByRole("table").getByRole("link").filter({ hasText: /\S/ }).first().click();
  await page.waitForURL(/\/people\/[^/]+$/);
  await audit(page, "profile");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search the workspace" }).fill("we");
  await audit(page, "search");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Notifications/ }).click();
  await audit(page, "notifications");
  await page.keyboard.press("Escape");
  // "Send feedback": the dialog, then its thanks once sent; the shared screen and the remote have no button
  await page.getByRole("button", { name: "Send feedback" }).click();
  await audit(page, "feedback");
  await page.getByRole("radio", { name: "An idea" }).check();
  await page.getByLabel("Your message").fill("Show last week's check-ins during the round table.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();
  await audit(page, "feedback sent");
  await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.goto(workspace);
  await audit(page, "dashboard with a meeting");
  await page.goto(`${meeting}/screen`);
  await audit(page, "shared screen");
  await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);
  await page.goto(`${meeting}/remote`);
  await audit(page, "phone remote");
  for (const tab of ["", "/security", "/notifications", "/workspaces"]) {
    await page.goto(`/account${tab}`);
    await audit(page, `account${tab}`);
  }

  // Dark theme: the same pages keep enough contrast
  await page.emulateMedia({ colorScheme: "dark" });
  for (const [label, path] of [
    ["home (dark)", workspace],
    ["control room (dark)", `${meeting}/control`],
    ["settings (dark)", `${meeting}/settings`],
    ["my screen (dark)", `${meeting}/me`],
    ["history (dark)", `${meeting}/history`],
  ]) {
    await page.goto(path!);
    await audit(page, label!);
  }
});
