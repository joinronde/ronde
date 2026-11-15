import { expect, test } from "@playwright/test";
import { choose } from "./select";

const run = Date.now().toString(36);
const owner = { name: "Ada Lovelace", email: `ada-${run}@example.com`, password: "correct-horse-battery" };
const invitee = { name: "Grace Hopper", email: `grace-${run}@example.com`, password: "another-long-password" };
const workspace = `E2E team ${run}`;

test("sign up, create a workspace, invite someone who joins", async ({ page, browser }) => {
  // About twenty pages for two people: more than the default budget on a busy machine
  test.setTimeout(90_000);
  // The owner creates an account and lands on the onboarding page
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(owner.name);
  await page.getByLabel("Email", { exact: true }).fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Welcome, Ada!" })).toBeVisible();

  // Workspace creation: only the name is asked; the address follows it, one click away
  await page.getByLabel("Workspace name").fill(workspace);
  await expect(page.getByText(`Address /w/e2e-team-${run}`)).toBeVisible();
  await page.getByRole("button", { name: "Change" }).click();
  await expect(page.getByLabel("Address")).toHaveValue(`e2e-team-${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/e2e-team-${run}$`));
  await expect(page.getByRole("heading", { level: 1, name: /\bAda$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(workspace);

  // Before the first meeting, the home page only offers to create it: the invitation goes through the directory;
  // without a mail server the link is shown to share by hand
  await expect(page.getByRole("heading", { name: "Create your first meeting" })).toBeVisible();
  await page.getByRole("link", { name: "Directory" }).click();
  await page.getByRole("button", { name: "Invite people" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite someone" });
  // The keyboard starts in the first field, not on a button further down
  await expect(dialog.getByLabel("Email", { exact: true })).toBeFocused();
  await dialog.getByLabel("Email", { exact: true }).fill(invitee.email);
  await dialog.getByLabel("First name").fill("Grace");
  await dialog.getByLabel("Last name").fill("Hopper");
  await dialog.getByRole("button", { name: "Send the invitation" }).click();
  const link = page.getByRole("dialog", { name: "Invitation link" }).getByRole("textbox");
  await expect(link).toHaveValue(/\/invite\/[\w-]+$/);
  const url = await link.inputValue();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("row", { name: /Grace Hopper/ })).toContainText("Invited");

  // The invitee opens the link in their own browser, creates an account and joins
  const other = await browser.newContext({ locale: "en-US" });
  const guest = await other.newPage();
  await guest.goto(url);
  await expect(guest.getByRole("heading", { name: `Join ${workspace}` })).toBeVisible();
  await guest.getByRole("link", { name: "Create an account" }).click();
  await guest.waitForURL(/\/sign-up\?/);
  await expect(guest.getByLabel("Email", { exact: true })).toHaveValue(invitee.email);
  await guest.getByLabel("Full name").fill(invitee.name);
  await guest.getByLabel("Password", { exact: true }).fill(invitee.password);
  await guest.getByRole("button", { name: "Create account" }).click();
  // The new account joins at once
  await expect(guest).toHaveURL(new RegExp(`/w/e2e-team-${run}$`));
  await expect(guest.getByRole("heading", { level: 1, name: /\bGrace$/ })).toBeVisible();

  // A member cannot invite: no invite button in the directory
  await guest.goto(`/w/e2e-team-${run}/people`);
  await expect(guest.getByRole("row", { name: /Ada Lovelace/ })).toContainText("Owner");
  await expect(guest.getByRole("button", { name: "Invite people" })).toHaveCount(0);
  await other.close();

  // Back on the owner's side, Grace is now a member
  await page.reload();
  await expect(page.getByRole("row", { name: /Grace Hopper/ })).toContainText("Member");
});

test("a new workspace looks around a sample meeting, then deletes it", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill("Mary Somerville");
  await page.getByLabel("Email", { exact: true }).fill(`mary-${run}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("sample-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Workspace name").fill(`Sample ${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/sample-${run}$`));

  // Opened from the empty home: a weekly sync with a fictitious team, its history and stats, marked as a sample
  await page.getByRole("button", { name: "Open the sample meeting" }).click();
  await page.waitForURL(/\/control$/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Skip the tour" }).click();
  const banner = page.getByRole("note").filter({ hasText: "Sample meeting:" });
  await expect(banner).toBeVisible();
  await expect(page.getByRole("link", { name: "Weekly sync (sample)" }).first()).toBeVisible();
  await expect(page.getByText("Emma Laurent").first()).toBeVisible();
  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByText("4 meetings")).toBeVisible();

  // It ticks none of the first steps, and its people are shown as fictitious
  await page.goto(`/w/sample-${run}`);
  await expect(page.getByText("0 of 4")).toBeVisible();
  await page.goto(`/w/sample-${run}/people`);
  await expect(page.getByRole("row", { name: /Emma Laurent/ })).toContainText("Sample");

  // Deleted for good from its banner: the home offers it again, the directory is empty of it
  await page.goto(`/w/sample-${run}`);
  await page.getByRole("link", { name: "Weekly sync (sample)" }).first().click();
  await page.getByRole("button", { name: "Delete the sample" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete the sample" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/sample-${run}$`));
  await expect(page.getByRole("button", { name: "Open the sample meeting" })).toBeVisible();
  await page.goto(`/w/sample-${run}/people`);
  await expect(page.getByRole("row", { name: /Emma Laurent/ })).toHaveCount(0);
});

test("private pages send signed-out visitors to sign-in, and come back after", async ({ page }) => {
  await page.goto(`/account`);
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
  await page.getByLabel("Email", { exact: true }).fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  // The account opens on its profile, under the name of the person signed in
  await expect(page.getByRole("heading", { level: 1, name: owner.name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
});

test("wrong password shows an error, a stranger's workspace is a 404", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // (Next.js also renders a route announcer with role="alert")
  await expect(page.locator(".form-alert")).toHaveText("Wrong email or password.");
  // The keyboard is back where the mistake is
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();

  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/w\//);
  const response = await page.goto(`/w/does-not-exist-${run}`);
  expect(response?.status()).toBe(404);
});

test("an email link used twice opens the email link sign-in, which can send the link again", async ({ page }) => {
  // The pause before sending again is 30 seconds
  test.setTimeout(90_000);
  // Better Auth comes back here with this code for a link already used or expired
  await page.goto("/sign-in?error=INVALID_TOKEN");
  await expect(page.locator(".form-alert")).toHaveText("This link has expired. Ask for a new one.");
  await expect(page.getByRole("radio", { name: "With email link" })).toBeChecked();
  await page.getByLabel("Email", { exact: true }).fill(owner.email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  // Sent again only after a pause, so a double click does not send two
  const again = page.getByRole("button", { name: "Send the link again" });
  await expect(again).toBeDisabled();
  await expect(again).toBeEnabled({ timeout: 40_000 });
});

test("a role that runs the workspace is given after a confirmation; anyone leaves from their account", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const role = (p: typeof page) => p.getByRole("combobox", { name: "Role of Grace Hopper" });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/w\//);
  await page.goto(`/w/e2e-team-${run}/people`);
  // Owner, then cancelled: nothing changes
  await choose(page, role(page), "owner");
  const ask = page.getByRole("dialog");
  await expect(ask).toContainText("Give Grace Hopper the role “Owner”?");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(role(page)).toContainText("Member");
  await page.reload();
  await expect(role(page)).toContainText("Member");
  // Admin, confirmed
  await choose(page, role(page), "admin");
  await page.getByRole("dialog").getByRole("button", { name: "Change the role" }).click();
  await expect(role(page)).toContainText("Admin");
  await page.reload();
  await expect(role(page)).toContainText("Admin");
  // Taking the running of the workspace away is asked too
  await choose(page, role(page), "member");
  await page.getByRole("dialog").getByRole("button", { name: "Change the role" }).click();
  await expect(role(page)).toContainText("Member");

  // Grace leaves from her account's list of workspaces, without the settings administrators see
  const grace = await (await browser.newContext({ locale: "en-US" })).newPage();
  await grace.goto("/sign-in");
  await grace.getByLabel("Email", { exact: true }).fill(invitee.email);
  await grace.getByLabel("Password", { exact: true }).fill(invitee.password);
  await grace.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(grace).toHaveURL(/\/w\//);
  await grace.goto("/account/workspaces");
  await grace.getByRole("button", { name: `Leave ${workspace}` }).click();
  await grace.getByRole("dialog").getByRole("button", { name: "Leave the workspace" }).click();
  await expect(grace.getByText("You are not in any workspace yet.")).toBeVisible();
  await grace.context().close();
});

test("a password too short is refused in Ronde's words, not the browser's", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill("Short Pass");
  await page.getByLabel("Email", { exact: true }).fill(`short-${run}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  // The message of the app, under the field: the browser's own bubble would leave the page unchanged
  await expect(page.getByText("Choose a password of at least 10 characters.").first()).toBeVisible();
  await expect(page).toHaveURL(/\/sign-up/);
});

test("the forms wait for the page to be ready before they can be sent", async ({ browser }) => {
  // Before the page's code runs (a slow phone), a click would send the form natively and empty it
  const page = await (await browser.newContext({ locale: "en-US", javaScriptEnabled: false })).newPage();
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  await page.goto("/sign-up");
  await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
  await page.context().close();
});

test("the notifications say they are loading, not that there are none, until they come", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/w\//);
  // A slow network: the list takes its time
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/w/*/inbox", async (route) => {
    await held;
    await route.continue();
  });
  await page.reload();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Loading…" })).toBeAttached();
  await expect(page.getByText("You're all caught up.")).toHaveCount(0);
  release();
  await expect(page.getByText("You're all caught up.")).toBeVisible();
});

test("the new meeting's wizard: typing goes to the name, Back goes back a step, leaving is asked", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/w\//);
  await page.goto(`/w/e2e-team-${run}/meetings/new`);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  // The name is the field to fill: the keyboard is in it
  await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
  await page.keyboard.type("Site meeting");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Site meeting");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  // The browser's Back (a phone's back gesture) goes back one step, what was typed kept
  await page.goBack();
  await expect(page).toHaveURL(/\/meetings\/new/);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Site meeting");
  // Leaving from the sidebar asks first; staying keeps everything
  await page.getByRole("navigation").getByRole("link", { name: "Dashboard" }).first().click();
  const ask = page.getByRole("dialog");
  await expect(ask).toContainText("Leave the new meeting?");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/meetings\/new/);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Site meeting");
  await page.getByRole("navigation").getByRole("link", { name: "Dashboard" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/e2e-team-${run}$`));
});
