import { expect, type Page, test } from "@playwright/test";
import { createMeeting, createWorkspace, hostWithWorkspace, invite, signIn, signUp } from "./helpers";

// Ways into a workspace or a meeting: an invitation opened by someone who already has an account, by the wrong
// account, a template picked on the site, and a guest link that shows the shared screen without an account

const run = Date.now().toString(36);

test("an existing account joins from an invitation; the wrong account switches to the invited one", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const host = { name: "Ivy Inviter", email: `ivy-${run}@example.com`, password: "host-password-123" };
  const paul = { name: "Paul Present", email: `paul-${run}@example.com`, password: "paul-password-123" };
  const quinn = { name: "Quinn Other", email: `quinn-${run}@example.com`, password: "quinn-password-123" };
  const workspace = await hostWithWorkspace(page, host, `Invites ${run}`);
  const name = `Invites ${run}`;

  // Paul and Quinn already have their accounts, Paul with a workspace of his own
  const paulPage = await (await browser.newContext({ locale: "en-US" })).newPage();
  await signUp(paulPage, paul);
  await createWorkspace(paulPage, `Paul ${run}`);
  const quinnCtx = await browser.newContext({ locale: "en-US" });
  await signUp(await quinnCtx.newPage(), quinn);
  await quinnCtx.close();

  const forPaul = await invite(page, workspace, paul.email, "Paul", "Present");
  const forQuinn = await invite(page, workspace, quinn.email, "Quinn", "Other");

  // Quinn's invitation opened in Paul's browser: it names the invited address and offers to switch accounts
  await paulPage.goto(forQuinn);
  await expect(paulPage.getByText(`This invitation was sent to ${quinn.email}`)).toBeVisible();
  await expect(paulPage.getByRole("button", { name: `Join ${name}` })).toHaveCount(0);
  await paulPage.getByRole("button", { name: "Use another account" }).click();
  await paulPage.waitForURL(/\/sign-in\?next=%2Finvite%2F/);
  await signIn(paulPage, quinn.email, quinn.password, paulPage.url());
  await paulPage.waitForURL(/\/invite\//);
  await expect(paulPage.getByText(`Signed in as ${quinn.email}`)).toBeVisible();
  await paulPage.getByRole("button", { name: `Join ${name}` }).click();
  await expect(paulPage).toHaveURL(new RegExp(`${new URL(workspace).pathname}$`));
  await paulPage.context().close();

  // Paul, signed in, opens his invitation: one click to join, no account to create
  const paulBack = await (await browser.newContext({ locale: "en-US" })).newPage();
  await signIn(paulBack, paul.email, paul.password, `/sign-in?next=${encodeURIComponent(new URL(forPaul).pathname)}`);
  await paulBack.waitForURL(/\/invite\//);
  await expect(paulBack.getByRole("heading", { name: `Join ${name}` })).toBeVisible();
  await expect(paulBack.getByText(`Signed in as ${paul.email}`)).toBeVisible();
  await expect(paulBack.getByText("Your role: Member")).toBeVisible();
  await paulBack.getByRole("button", { name: `Join ${name}` }).click();
  await expect(paulBack).toHaveURL(new RegExp(`${new URL(workspace).pathname}$`));
  // Both his workspaces are now in the switcher
  await paulBack.getByRole("button", { name: "Switch workspace" }).click();
  await expect(paulBack.getByRole("link", { name: `Paul ${run}` })).toBeVisible();
  await paulBack.keyboard.press("Escape");
  // The same link once in: said so, with the way to the workspace
  await paulBack.goto(forPaul);
  await expect(paulBack.getByRole("heading", { name: "You're already in" })).toBeVisible();
  await paulBack.getByRole("link", { name: `Open ${name}` }).click();
  await expect(paulBack).toHaveURL(new RegExp(`${new URL(workspace).pathname}$`));
  await paulBack.context().close();

  // The host's directory: both are members now
  await page.goto(`${workspace}/people`);
  await expect(page.getByRole("row", { name: /Paul Present/ })).toContainText("Member");
  await expect(page.getByRole("row", { name: /Quinn Other/ })).toContainText("Member");
});

test("a template picked on the site opens the wizard of the first meeting on it", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, { name: "Tara Template", email: `tara-${run}@example.com`, password: "template-password-123" });
  await page.waitForURL(/\/onboarding$/);
  await page.goto("/onboarding?template=retro");
  await page.getByLabel("Workspace name").fill(`Retro ${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  await page.waitForURL(/\/meetings\/new\?template=builtin%3Aretro$/, { timeout: 60_000 });
  // Straight to the details of a meeting on that template
  await expect(page.getByLabel("Name")).toHaveAttribute("placeholder", "Monthly retrospective");
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByRole("definition").filter({ hasText: "Monthly retrospective" }).first()).toBeVisible();

  // An unknown template is ignored: the plain onboarding
  await page.goto("/onboarding?template=nope");
  await expect(page.getByRole("heading", { name: "Your workspaces" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open" }).first()).toHaveAttribute("href", /^\/w\/retro-[^/?]+$/);
});

test("a guest link shows the meeting live without an account, until it is revoked", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const workspace = await hostWithWorkspace(
    page,
    { name: "Gina Guestlink", email: `gina-${run}@example.com`, password: "guest-link-123" },
    `Guests ${run}`,
  );
  const meeting = await createMeeting(page, workspace, "Board review");

  // Created from the people section of the settings: the link is shown once
  await page.goto(`${meeting}/settings#people`);
  const panel = page.getByRole("region", { name: "Guest links" });
  await panel.getByRole("textbox", { name: "Who it is for" }).fill("Board members");
  await panel.getByRole("button", { name: "Create a link" }).click();
  await expect(panel.getByText("Copy this link now and share it: it will not be shown again.")).toBeVisible();
  const link = await panel.getByRole("textbox", { name: "Guest link" }).inputValue();
  expect(link).toMatch(/\/g\/[\w-]+$/);
  await expect(panel.getByRole("listitem").filter({ hasText: "Board members" })).toContainText("Valid until");

  // The guest, in a browser with no account, sees the shared screen
  const guestCtx = await browser.newContext({ locale: "en-US" });
  const guest: Page = await guestCtx.newPage();
  await guest.goto(link);
  await expect(guest).toHaveURL(link);
  await expect(guest.getByText("Board review").first()).toBeVisible();

  // The host starts and moves on: the guest's screen follows live
  await expect(guest.getByRole("region", { name: "Introduction" })).toContainText("The meeting starts soon");
  await page.goto(`${meeting}/control`);
  // Clicked again until it holds: the click can come before the control room is ready
  await expect(async () => {
    await page.getByRole("button", { name: "Start the meeting" }).click();
    await expect(page.getByRole("button", { name: /End the meeting/ })).toBeVisible({ timeout: 2000 });
  }).toPass();
  await expect(guest.getByText("The meeting starts soon")).toHaveCount(0);
  await page.getByRole("button", { name: /^Next: Gina/ }).click();
  await expect(guest.getByRole("region", { name: "Introduction" })).toHaveCount(0);
  await expect(guest.getByRole("heading", { level: 2, name: "Gina Guestlink" })).toBeVisible();

  // Read-only: no control of the meeting from there, and no way into the workspace
  await expect(guest.getByRole("button", { name: /^Next/ })).toHaveCount(0);
  await guest.goto(`${meeting}/control`);
  await expect(guest).toHaveURL(/\/sign-in/);

  // Revoked: the link no longer opens anything
  await page.goto(`${meeting}/settings#people`);
  await panel.getByRole("listitem").filter({ hasText: "Board members" }).getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Link revoked")).toBeVisible();
  await expect(panel.getByRole("listitem").filter({ hasText: "Board members" })).toHaveCount(0);
  const gone = await guest.goto(link);
  expect(gone?.status()).toBe(404);
  await guestCtx.close();
});
