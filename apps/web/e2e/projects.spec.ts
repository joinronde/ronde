import { expect, test } from "@playwright/test";

const run = Date.now().toString(36);
const host = { name: "Ines Lead", email: `ines-${run}@example.com`, password: "lead-password-123" };

test("a project of the portfolio gets its turn in a meeting, then its page tells what was said", async ({ page }) => {
  // The pages of a meeting are large: their first compilation by the dev server is slow
  test.setTimeout(300_000);
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(host.name);
  await page.getByLabel("Email", { exact: true }).fill(host.email);
  await page.getByLabel("Password", { exact: true }).fill(host.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Workspace name").fill(`Portfolio ${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  await page.waitForURL(/\/w\/portfolio-/);
  const workspace = page.url();

  // The portfolio: a theme, then a project led by its creator
  await page.goto(`${workspace}/projects`);
  await page.getByRole("button", { name: "Themes" }).click();
  const themes = page.getByRole("dialog", { name: "Themes" });
  await themes.getByPlaceholder("New theme").fill("Platform");
  await themes.getByRole("button", { name: "Add", exact: true }).click();
  await expect(themes.getByRole("textbox", { name: "Name of the theme" }).first()).toHaveValue("Platform");
  // A second one added in the same dialog shows its name too (it used to come up as an empty field)
  await themes.getByPlaceholder("New theme").fill("Growth");
  await themes.getByRole("button", { name: "Add", exact: true }).click();
  await expect(themes.getByRole("textbox", { name: "Name of the theme" })).toHaveCount(2);
  await expect(themes.getByRole("textbox", { name: "Name of the theme" }).nth(1)).toHaveValue("Growth");
  await themes.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "New project" }).first().click();
  const form = page.getByRole("dialog", { name: "New project" });
  await form.getByLabel("Name", { exact: true }).fill("Billing API");
  await form.getByLabel("In one line").fill("Invoices for the finance teams");
  await form.getByRole("combobox", { name: "Theme" }).click();
  await page.getByRole("option", { name: "Platform" }).click();
  // The lead is whoever creates the project, named once as themselves: no "Me" beside their own name
  const lead = form.getByRole("combobox", { name: "Lead" });
  await expect(lead).toContainText("(you)");
  await lead.click();
  await expect(page.getByRole("option", { name: /\(you\)$/ })).toHaveCount(1);
  await expect(page.getByRole("option", { name: "Me", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: /\(you\)$/ }).click();
  await form.getByRole("button", { name: "Create the project" }).click();
  await page.waitForURL(/\/projects\/billing-api$/);
  await expect(page.getByRole("heading", { name: "Billing API", level: 1 })).toBeVisible();

  // A meeting with a project round, following the project
  await page.goto(`${workspace}/meetings/new`);
  await page.getByText("Team and projects").click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Name").fill("Team sync");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  // Sections and modules: the template's, kept as they are
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Create the meeting" }).click();
  await page.waitForURL(/\/m\/[^/]+\/control$/, { timeout: 120_000 });
  const meeting = page.url().replace(/\/control$/, "");
  await page.goto(`${meeting}/settings#projects`);
  // Nothing followed yet: the empty state says what to do, the picker lists the portfolio
  await page.getByRole("button", { name: "Follow a project" }).click();
  await page
    .getByRole("dialog", { name: "Follow a project" })
    .getByRole("button", { name: /Billing API/ })
    .click();
  // The first operation compiles the operations route of the dev server
  await expect(page.getByText("Billing API followed")).toBeVisible({ timeout: 120_000 });
  // Who adds projects: the hosts by default, every participant once chosen
  await expect(page.getByRole("radio", { name: /The hosts/ })).toBeChecked();
  await page.getByText("Every participant").click();
  await expect(page.getByRole("radio", { name: /Every participant/ })).toBeChecked();

  // The lead writes the project's sheet and an item in its tab
  await page.goto(`${meeting}/me`);
  await page.getByRole("tab", { name: /Billing API/ }).click();
  await page.getByRole("radio", { name: /At risk/ }).check();
  await page.getByLabel("Message of the day").fill("Staging is still closed");
  // The sheet saves itself as it is written
  await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible();
  await page
    .getByPlaceholder(/Add an item/)
    .first()
    .fill("Invoices endpoint");
  // The line joins the list as the field is left, and the check-in saves itself a moment later
  await page
    .getByPlaceholder(/Add an item/)
    .first()
    .press("Tab");
  await expect(page.locator(".checkin-status")).toContainText("Saving");
  await expect(page.locator(".checkin-status")).toContainText("Saved");

  // Live: the project has its own step, after the round table
  await page.goto(`${meeting}/control`);
  await page.getByRole("button", { name: "Skip the tour" }).click();
  await page.getByRole("button", { name: "Start the meeting" }).click();
  await page.getByRole("button", { name: /^Next: / }).click();
  await page.getByRole("button", { name: "Next: Billing API" }).click();
  await expect(page.getByRole("heading", { name: "Billing API", level: 2 }).first()).toBeVisible();
  await expect(page.getByText("Project round · 1 / 1").first()).toBeVisible();

  await page.getByRole("button", { name: /End the meeting/ }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();
  // At the wrap-up, the control room's main button opens the minutes, published from there
  await page.getByRole("button", { name: "Review and publish the minutes" }).click();
  await page.getByRole("button", { name: "Publish the minutes", exact: true }).click();
  await page.getByRole("button", { name: "Yes, publish" }).click();
  await expect(page.getByText("Minutes published, session closed.")).toBeVisible();

  // The minutes have a part for the projects, and the project's page tells what the meeting said
  await page.goto(`${meeting}/history`);
  const minutes = page.locator(".minutes-doc");
  await expect(minutes.getByRole("heading", { name: "Projects", level: 2 })).toBeVisible();
  await expect(minutes.getByText("Staging is still closed")).toBeVisible();
  await page.goto(`${workspace}/projects/billing-api`);
  const timeline = page.getByRole("region", { name: "What the meetings said" });
  await expect(timeline.getByText("Staging is still closed")).toBeVisible();
  await expect(timeline.getByText("Invoices endpoint")).toBeVisible();
  // At risk since the sheet was presented
  await page.goto(`${workspace}/projects`);
  await expect(
    page
      .locator(".project-card")
      .filter({ hasText: "Billing API" })
      .getByText(/At risk/)
      .first(),
  ).toBeAttached();
  // From five projects to two hundred: a compact list, then a table, kept on the next visit
  await page.getByRole("button", { name: "Compact list" }).click();
  await expect(page.locator(".project-row").filter({ hasText: "Billing API" })).toBeVisible();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const table = page.locator(".project-table");
  await expect(table.getByRole("columnheader", { name: "Health" })).toBeVisible();
  await expect(table.getByRole("link", { name: "Billing API" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".project-table").getByRole("link", { name: "Billing API" })).toBeVisible();
  // A group folds away, and opens again
  const group = page.getByRole("button", { name: /^Platform/ });
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".project-table")).toHaveCount(0);
  await group.click();
  await expect(page.locator(".project-table").getByRole("link", { name: "Billing API" })).toBeVisible();
});
