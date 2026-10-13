import { expect, test } from "@playwright/test";
import { signIn, totp } from "../helpers";
import { Inbox, signUpConfirmed } from "./inbox";

// Getting back in: the address check at sign-up, a forgotten password, a sign-in link by email, and the code of
// two-step verification. The links are read from the messages the app sends to a fake mail server.

const run = Date.now().toString(36);
const inbox = new Inbox();

test.beforeAll(async () => {
  await inbox.start();
});
test.afterAll(async () => {
  await inbox.stop();
});

test("an address is confirmed at sign-up, then a forgotten password is reset from the email", async ({ page }) => {
  test.setTimeout(180_000);
  const who = { name: "Rita Reset", email: `rita-${run}@example.com`, password: "first-password-123" };

  // Before the address is confirmed, the password alone does not sign in: a new link is sent
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(who.name);
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  await expect.poll(() => inbox.count(who.email)).toBe(1);
  await signIn(page, who.email, who.password);
  await expect(page.locator(".form-alert")).toHaveText("Confirm your email address first: we just sent you a new link.");
  await expect.poll(() => inbox.count(who.email)).toBe(2);
  // The link of the latest message confirms the address and signs in
  await page.goto(await inbox.link(who.email, /^Confirm your email address/));
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Welcome, Rita!" })).toBeVisible();

  // Signed out, the password is forgotten: "Forgot password?" carries the address typed
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByRole("link", { name: "Forgot password?" }).click();
  // (compiled on its first visit by the dev server)
  await page.waitForURL(/\/forgot-password\?email=/, { timeout: 60_000 });
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(who.email);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByText(`If an account exists for ${who.email}, we sent it a link to choose a new password.`)).toBeVisible();

  // The link opens the form for the new password
  const link = await inbox.link(who.email, /^Reset your password/);
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByLabel("New password").fill("second-password-456");
  await page.getByRole("button", { name: "Save the password" }).click();
  await expect(page.getByText("Your password has been changed. You can now sign in.")).toBeVisible();

  // The link works once
  await page.goto(link);
  await expect(page.getByText("This link is invalid or has expired. Ask for a new one.")).toBeVisible();

  // The old password is refused, the new one signs in
  await signIn(page, who.email, who.password);
  await expect(page.locator(".form-alert")).toHaveText("Wrong email or password.");
  await signIn(page, who.email, "second-password-456");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("an unknown address asking for a reset is told the same, and receives nothing", async ({ page }) => {
  const nobody = `nobody-${run}@example.com`;
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill(nobody);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByText(`If an account exists for ${nobody}, we sent it a link to choose a new password.`)).toBeVisible();
  expect(inbox.count(nobody)).toBe(0);
});

test("a sign-in link sent by email signs in without the password", async ({ page }) => {
  test.setTimeout(120_000);
  const who = { name: "Lina Link", email: `lina-${run}@example.com`, password: "link-password-123" };
  await signUpConfirmed(page, inbox, who);
  await page.context().clearCookies();

  // Asked from a private page: the link brings back to it
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
  await page.getByRole("radio", { name: "With email link" }).check();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  await expect(page.getByText(`We sent a sign-in link to ${who.email}`)).toBeVisible();
  await page.goto(await inbox.link(who.email, /^Your sign-in link/));
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { level: 1, name: who.name })).toBeVisible();
});

test("two-step verification: turned on with an authenticator code, then asked at each sign-in", async ({ page }) => {
  test.setTimeout(180_000);
  const who = { name: "Tomas Totp", email: `tomas-${run}@example.com`, password: "totp-password-123" };
  await signUpConfirmed(page, inbox, who);

  // Turned on: password, then the code of the app set up with the key shown
  await page.goto("/account/security");
  const section = page.getByRole("region", { name: "Two-step verification" });
  await expect(section.getByText("Off", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "Turn on" }).click();
  await section.getByLabel("Confirm with your password").fill(who.password);
  await section.getByRole("button", { name: "Continue" }).click();
  await expect(section.getByRole("img", { name: /Scan this code/ })).toBeVisible();
  const secret = (await section.locator("code.secret").textContent())!.trim();
  await section.getByRole("textbox", { name: "Code" }).fill("000000");
  await section.getByRole("button", { name: "Confirm" }).click();
  await expect(section.locator(".form-alert")).toHaveText("Invalid or expired code.");
  await section.getByRole("textbox", { name: "Code" }).fill(totp(secret));
  await section.getByRole("button", { name: "Confirm" }).click();
  await expect(section.getByText("Two-step verification is on.")).toBeVisible();
  const codes = (await section.locator(".backup-codes code").allTextContents()).map((c) => c.trim());
  expect(codes.length).toBeGreaterThan(0);
  await section.getByRole("button", { name: "Done" }).click();
  await expect(section.getByText("On", { exact: true })).toBeVisible();

  // Signed out: the password leads to the code; a wrong one is refused
  await page.context().clearCookies();
  await signIn(page, who.email, who.password);
  await expect(page).toHaveURL(/\/sign-in\/two-factor/);
  await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
  await page.getByLabel("Code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.locator(".form-alert")).toHaveText("Invalid or expired code.");
  await page.getByLabel("Code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  // A backup code stands in for the phone, once
  await page.context().clearCookies();
  await signIn(page, who.email, who.password);
  await expect(page).toHaveURL(/\/sign-in\/two-factor/);
  await page.getByRole("button", { name: "Use a backup code" }).click();
  await page.getByLabel("Backup code").fill(codes[0]!);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  // An emailed link would skip the code: refused for this account
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: "With email link" }).check();
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.locator(".form-alert")).toHaveText(
    "This account is protected by two-factor authentication: sign in with your password, then your code.",
  );
});
