import { readFileSync } from "node:fs";
import { type Browser, expect, type Page, test } from "@playwright/test";

const run = Date.now().toString(36);
const host = { name: "Hana Host", email: `hana-${run}@example.com`, password: "host-password-123" };
const guest = { name: "Gus Guest", email: `gus-${run}@example.com`, password: "guest-password-123" };

async function signUp(page: Page, who: typeof host, path = "/sign-up") {
  await page.goto(path);
  await page.getByLabel("Full name").fill(who.name);
  if (await page.getByLabel("Email", { exact: true }).isEditable()) await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

async function guestJoins(browser: Browser, url: string) {
  const ctx = await browser.newContext({ locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.waitForURL(/\/sign-up\?/);
  await signUp(page, guest, page.url());
  await page.getByRole("button", { name: /^Join / }).click();
  await page.waitForURL(/\/w\/[^/]+$/);
  return page;
}

test("a host creates a meeting, a participant fills in their check-in and raises a hand live", async ({ page, browser }) => {
  // The control room and "My screen" are large pages: their first compilation by the dev server is slow
  test.setTimeout(240_000);
  // Host: account, workspace, invitation
  await signUp(page, host);
  await page.getByLabel("Workspace name").fill(`Live ${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  await page.waitForURL(/\/w\/live-/);
  const workspace = page.url();
  await page.goto(`${workspace}/people?invite=1`);
  const dialog = page.getByRole("dialog", { name: "Invite someone" });
  await dialog.getByLabel("Email", { exact: true }).fill(guest.email);
  await dialog.getByLabel("First name").fill("Gus");
  await dialog.getByLabel("Last name").fill("Guest");
  await dialog.getByRole("button", { name: "Send the invitation" }).click();
  const url = await page.getByRole("dialog", { name: "Invitation link" }).getByRole("textbox").inputValue();

  // The meeting is created from the weekly sync template with the invited person (no account yet: profiles
  // exist before sign-up), in three steps
  await page.goto(`${workspace}/meetings/new`);
  await expect(page.getByRole("radio", { name: /Weekly sync/ })).toBeChecked();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Name").fill("Weekly sync");
  await expect(page.getByRole("checkbox", { name: /Gus Guest/ })).toBeChecked();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  // Sections and modules: the template's, kept as they are
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("2 people in the round table")).toBeVisible();
  await page.getByRole("button", { name: "Create the meeting" }).click();
  await page.waitForURL(/\/m\/[^/]+\/control$/, { timeout: 120_000 });
  const meeting = page.url().replace(/\/control$/, "");
  await page.getByRole("button", { name: "Skip the tour" }).click();
  await expect(page.getByRole("heading", { name: "Weekly sync", level: 1 })).toBeVisible();

  // The participant joins the workspace and finds the meeting on their home page
  const gus = await guestJoins(browser, url);
  await gus
    .getByRole("main")
    .getByRole("region", { name: "Meetings" })
    .getByRole("link", { name: /Weekly sync/ })
    .click();
  await gus.waitForURL(/\/me$/, { timeout: 120_000 });
  // Typed without Enter, then the field left: the item is kept, and saves itself
  await gus
    .getByPlaceholder(/Add an item/)
    .first()
    .fill("Shipped the login page");
  await gus
    .getByPlaceholder(/Add an item/)
    .first()
    .press("Tab");
  // The check-in saves itself a moment after the last keystroke
  await expect(gus.locator(".checkin-status")).toContainText("Saving");
  await expect(gus.locator(".checkin-status")).toContainText("Saved");

  // The host sees the check-in ready, without reloading (real time)
  await expect(page.getByText("1/2 check-ins filled in")).toBeVisible({ timeout: 15_000 });

  // Live: the host starts, the participant raises a hand, the host sees it
  await page.getByRole("button", { name: "Start the meeting" }).click();
  await gus.getByRole("button", { name: "Raise my hand" }).click();
  await expect(page.getByRole("button", { name: "Next: Questions (1)" })).toBeVisible({ timeout: 15_000 });

  // Command palette: Ctrl+K, a few words, Enter
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Commands" }).fill("panel live");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: /^Live/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Phone remote: the host moves on from it, the control room follows
  const remote = await page.context().newPage();
  await remote.goto(`${meeting}/remote`);
  await expect(remote.getByRole("heading", { level: 1 })).toHaveText("Introduction");
  await remote.getByRole("button", { name: "Next →" }).click();
  await expect(remote.getByRole("heading", { level: 1 })).toHaveText("Questions and discussion");
  await expect(page.getByRole("heading", { name: "Questions and discussion", level: 2 }).first()).toBeVisible();
  await remote.close();

  // The host turns raised hands off in the module catalog: the button leaves the participant's screen live
  await page.goto(`${meeting}/settings#modules`);
  await page.getByRole("switch", { name: "Use Raised hands and questions in this meeting" }).click();
  await expect(page.getByText("Raised hands and questions turned off")).toBeVisible();
  await expect(gus.getByRole("button", { name: "Lower my hand" })).toHaveCount(0);
  await expect(gus.getByRole("button", { name: "Raise my hand" })).toHaveCount(0);

  // A participant cannot open the control room: they are sent to their screen
  await gus.goto(`${meeting}/control`);
  await expect(gus).toHaveURL(/\/me$/);
  await gus.context().close();

  // Wrap-up: the host writes a summary on top of the generated minutes and archives
  await page.goto(`${meeting}/control`);
  await page.getByRole("button", { name: /End the meeting/ }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();
  // At the wrap-up, the control room's main button opens the minutes: summed up and published from there
  await page.getByRole("button", { name: "Review and publish the minutes" }).click();
  await page.getByRole("textbox", { name: "Summary" }).fill("A productive week for the login page.");
  await page.getByRole("button", { name: "Publish the minutes", exact: true }).click();
  await page.getByRole("button", { name: "Yes, publish" }).click();
  await expect(page.getByText("Minutes published, session closed.")).toBeVisible();

  // History: minutes built from the record
  await page.goto(`${meeting}/history`);
  const minutes = page.locator(".minutes-doc");
  await expect(minutes.getByText("A productive week for the login page.")).toBeVisible();
  await expect(minutes.getByText("Shipped the login page")).toBeVisible();
  await expect(minutes.getByRole("heading", { name: "Round table" })).toBeVisible();
  // PDF: the print dialog on the minutes alone (kept closed here), named after them; Markdown downloaded as is
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  const sheet = page.locator(".print-sheet");
  await expect(sheet).toContainText("A productive week for the login page.");
  await expect(sheet).toContainText("Shipped the login page");
  expect(await page.title()).toMatch(/^minutes-\d{4}-\d{2}-\d{2}$/);
  const markdown = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  expect((await markdown).suggestedFilename()).toMatch(/^minutes-\d{4}-\d{2}-\d{2}\.md$/);

  // Stats, computed by the server
  await page.goto(`${meeting}/stats`);
  const archived = page.locator(".kpi").filter({ has: page.locator(".l", { hasText: /^Sessions held$/ }) });
  await expect(archived.locator(".v")).toHaveText("1");

  // Exports for a spreadsheet: UTF-8 with its byte order mark, one line per archived session
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export as CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^stats-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await file.path())!, "utf8");
  expect(csv.startsWith("\uFEFFDate,Duration (min),Present,")).toBe(true);
  expect(csv.trim().split("\r\n")).toHaveLength(2);
  // The actions and the decisions of the workspace, built by the server
  const slug = new URL(meeting).pathname.split("/")[2];
  for (const [path, head] of [
    ["actions", "Action,Owner,Meeting,Status"],
    ["decisions", "Date,Meeting,Decision,Context"],
  ]) {
    const res = await page.request.get(`/api/w/${slug}/${path}/export`);
    expect(res.headers()["content-disposition"]).toContain(`filename="${path}-`);
    expect((await res.text()).startsWith(`\uFEFF${head}`)).toBe(true);
  }
});
