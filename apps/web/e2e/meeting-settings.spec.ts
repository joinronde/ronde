import { expect, test } from "@playwright/test";
import { createMeeting, hostWithWorkspace, invite, joinWithNewAccount } from "./helpers";
import { choose } from "./select";

// A meeting's settings: its people and their roles, a section of one's own, the schedule, the meeting kept as a
// template, then deleted; and the workspace left by a member, then deleted by its owner

const run = Date.now().toString(36);

test("people, sections, schedule, template and deletion of a meeting; leaving and deleting a workspace", async ({ page, browser }) => {
  test.setTimeout(420_000);
  const workspace = await hostWithWorkspace(
    page,
    { name: "Selma Settings", email: `selma-${run}@example.com`, password: "settings-password-123" },
    `Settings ${run}`,
  );
  const slug = new URL(workspace).pathname.split("/")[2]!;
  // The meeting is created before Rui joins the workspace: he is not in it yet
  const meeting = await createMeeting(page, workspace, "Team sync");
  const link = await invite(page, workspace, `rui-${run}@example.com`, "Rui", "Rocha");
  const rui = await joinWithNewAccount(browser, link, {
    name: "Rui Rocha",
    email: `rui-${run}@example.com`,
    password: "rui-password-1234",
  });

  // People: Rui is added from the directory, made an observer, then removed
  await page.goto(`${meeting}/settings#people`);
  await expect(page.getByRole("heading", { name: "People (1)" })).toBeVisible();
  await page.getByRole("combobox", { name: "Person" }).click();
  await page.getByRole("option", { name: /Rui Rocha/ }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Rui Rocha added to the meeting")).toBeVisible();
  await expect(page.getByRole("heading", { name: "People (2)" })).toBeVisible();
  await choose(page, page.getByRole("combobox", { name: "Role of Rui Rocha" }), "observer");
  await expect(page.getByRole("combobox", { name: "Role of Rui Rocha" })).toContainText("Observer");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Role of Rui Rocha" })).toContainText("Observer");
  // An observer follows the sessions without a check-in of his own
  await rui.goto(`${meeting}/me`);
  await expect(rui.locator(".checkin-status")).toHaveCount(0);
  // Back as a participant, so the section added below shows on his check-in
  await choose(page, page.getByRole("combobox", { name: "Role of Rui Rocha" }), "participant");
  await expect(page.getByRole("combobox", { name: "Role of Rui Rocha" })).toContainText("Participant");

  // Sections: a free section of the meeting's own, saved by itself, then on everyone's check-in
  await page.goto(`${meeting}/settings#sections`);
  await page.getByRole("button", { name: "+ Add a section" }).click();
  await page.getByRole("textbox", { name: "Name of section 5" }).fill("Demo to show");
  await expect(page.locator(".cfg-status")).toHaveClass(/is-saved/);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Name of section 5" })).toHaveValue("Demo to show");
  await rui.goto(`${meeting}/me`);
  await expect(rui.getByRole("group", { name: "Demo to show" })).toBeVisible();
  await rui.getByRole("textbox", { name: "Demo to show" }).fill("The new login page");
  // The line joins the list as the field is left, and the check-in saves itself a moment later
  await rui.getByRole("textbox", { name: "Demo to show" }).press("Tab");
  await expect(rui.locator(".checkin-status")).toContainText("Saving");
  await expect(rui.locator(".checkin-status")).toContainText("Saved");
  await rui.reload();
  await expect(rui.getByRole("group", { name: "Demo to show" })).toContainText("The new login page");

  // Schedule: Thursday instead of Monday; the summary and the next dates follow once saved (by itself)
  await page.goto(`${meeting}/settings#schedule`);
  await expect(page.locator(".schedule-summary")).toHaveText(/^Every Monday at 10:00/);
  await page.getByRole("button", { name: "Thu", exact: true }).click();
  await page.getByRole("button", { name: "Mon", exact: true }).click();
  await expect(page.getByRole("button", { name: "Thu", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Saved by itself a moment later, like the other settings
  await expect(page.locator(".schedule-status")).toHaveText("Schedule saved");
  await page.reload();
  await expect(page.locator(".schedule-summary")).toHaveText(/^Every Thursday at 10:00/);
  const dates = page.getByRole("region", { name: "Next dates" }).getByRole("listitem");
  await expect(dates.first()).toContainText("Thursday");
  await expect(dates.filter({ hasText: "Monday" })).toHaveCount(0);
  // A long list is searched rather than scrolled: the time zone, by part of a city's name
  await page.getByRole("combobox", { name: "Time zone", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search…" });
  await expect(search).toBeFocused();
  await search.fill("new y");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(1);
  await search.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);

  // Kept as a template: offered by the wizard, with the section added above, and deleted from there
  await page.goto(`${meeting}/settings#template`);
  await page.getByRole("button", { name: "Save as a template" }).click();
  await page.getByLabel("Template name").fill(`Our sync ${run}`);
  await page.getByLabel("Description (optional)").fill("The weekly sync with a demo");
  await page.getByRole("button", { name: "Save the template" }).click();
  await expect(page.getByText("Template saved: it is offered when creating a meeting.")).toBeVisible();
  await page.goto(`${workspace}/meetings/new`);
  const mine = page.getByRole("radio", { name: new RegExp(`Our sync ${run}`) });
  await expect(mine).toBeVisible();
  // Picked, its preview lists the section added above
  await page
    .locator("label.nm-tpl")
    .filter({ hasText: `Our sync ${run}` })
    .click();
  await expect(mine).toBeChecked();
  await expect(page.locator(".nm-preview")).toContainText("Demo to show");
  await page.getByRole("button", { name: `Delete the template Our sync ${run}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(mine).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("radio", { name: /Weekly sync/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: new RegExp(`Our sync ${run}`) })).toHaveCount(0);

  // Danger zone: the meeting's name typed to confirm; it leaves the lists and its pages close
  await page.goto(`${meeting}/settings#danger`);
  const remove = page.getByRole("button", { name: "Delete the meeting" });
  await expect(remove).toBeDisabled();
  await page.getByRole("textbox", { name: "Type Team sync to confirm" }).fill("Team");
  await expect(remove).toBeDisabled();
  await page.getByRole("textbox", { name: "Type Team sync to confirm" }).fill("Team sync");
  await remove.click();
  await page.waitForURL((url) => !url.pathname.includes("/m/"), { timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Meetings" }).getByRole("link", { name: "Team sync" })).toHaveCount(0);
  expect((await page.goto(`${meeting}/control`))?.status()).toBe(404);

  // Rui leaves the workspace from its settings, after a confirmation
  await rui.goto(`${workspace}/settings`);
  // In the page itself (while it streams in, a hidden copy may stand beside its loading skeleton)
  await expect(rui.locator("#main").getByText("Only admins can change these settings.")).toBeVisible();
  await rui.getByRole("button", { name: "Leave the workspace" }).click();
  const leave = rui.getByRole("dialog");
  await expect(leave).toContainText(`Leave Settings ${run}?`);
  await leave.getByRole("button", { name: "Leave the workspace" }).click();
  await rui.waitForURL((url) => !url.pathname.startsWith(`/w/${slug}`), { timeout: 60_000 });
  expect((await rui.goto(workspace))?.status()).toBe(404);
  await rui.context().close();

  // The owner deletes the workspace, its address typed to confirm: gone for everyone
  await page.goto(`${workspace}/settings`);
  await page.getByRole("button", { name: "Delete the workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete the workspace" });
  await dialog.getByLabel(/^Type/).fill(slug);
  await dialog.getByRole("button", { name: "Delete the workspace" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith(`/w/${slug}`), { timeout: 60_000 });
  expect((await page.goto(workspace))?.status()).toBe(404);
});

test("GitLab and GitHub connections: the workspace's, and a meeting's own", async ({ page }) => {
  test.setTimeout(180_000);
  const workspace = await hostWithWorkspace(
    page,
    { name: "Fern Forges", email: `fern-${run}@example.com`, password: "forges-password-123" },
    `Forges ${run}`,
  );
  const meeting = await createMeeting(page, workspace, "Forges");
  // The workspace's: added once for every meeting; an address that is not one is refused before the forge is asked
  await page.goto(`${workspace}/settings`);
  const forges = page.locator("#forges");
  await expect(forges.getByRole("heading", { name: "GitLab and GitHub" })).toBeVisible();
  // The server's own GitHub access, which reads public repositories, is listed but cannot be changed here
  await expect(forges.getByRole("listitem").filter({ hasText: "GitHub of the server" })).toBeVisible();
  await expect(forges.getByRole("listitem").filter({ hasText: "GitHub of the server" }).getByRole("button")).toHaveCount(0);
  await forges.getByRole("button", { name: "Add a connection" }).click();
  await forges.getByLabel("Server", { exact: true }).fill("ftp://git.acme.test");
  await forges.getByLabel("Token", { exact: true }).fill("glpat-demo");
  await forges.getByRole("button", { name: "Save" }).click();
  await expect(forges.getByText("The server address is not valid")).toBeVisible();
  // The meeting's GitLab card: the connections it uses, and one of its own to add
  await page.goto(`${meeting}/settings#integrations`);
  await page.getByRole("button", { name: /^GitLab/ }).click();
  await expect(page.getByRole("heading", { name: "GitLab connections" })).toBeVisible();
  await expect(page.getByText("No GitLab connection")).toBeVisible();
  await page.getByRole("button", { name: "Add a connection for this meeting only" }).click();
  await expect(page.locator(".forge-own").getByLabel("Token", { exact: true })).toBeVisible();
});
