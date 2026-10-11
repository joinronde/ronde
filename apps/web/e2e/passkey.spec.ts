import { expect, test } from "@playwright/test";

const run = Date.now().toString(36);
const who = { name: "Pia Passkey", email: `pia-${run}@example.com`, password: "a-long-enough-password" };

// A passkey added from the account's security page, then the only thing needed to sign in. Chromium's virtual
// authenticator stands in for the device's lock (face, fingerprint, PIN).
test("adds a passkey, then signs in with it alone", async ({ page, context }) => {
  test.setTimeout(120_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(who.name);
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.goto("/account/security");
  await expect(
    page.getByRole("navigation", { name: "Pages of your account" }).getByRole("link", { name: "Sign-in and security" }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByText("Passkey added")).toBeVisible();
  await expect(page.getByText("1 passkey")).toBeVisible();

  // Signed out: the passkey button signs back in, no email nor password typed
  await context.clearCookies();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});
