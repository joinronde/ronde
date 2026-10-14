import { expect, test } from "@playwright/test";
import { startFakeStripe } from "./stripe-fake";

// Billing of the cloud, end to end against a fake Stripe (stripe-fake.ts): a new workspace starts on Community,
// leaves Checkout without paying, pays and moves to Team once the webhook arrives, opens the customer portal and
// cancels there, and is back on Community.

const run = Date.now().toString(36);
const stripe = startFakeStripe();

test.beforeAll(() => stripe.listen());
test.afterAll(() => stripe.close());

test("a workspace moves to Team through Checkout, manages it in the portal and cancels", async ({ page }) => {
  // The app's own pages: while one streams in, a hidden copy may stand beside its loading skeleton
  const main = page.locator("#main");
  test.setTimeout(240_000);
  await page.goto(`/sign-up?next=${encodeURIComponent("/onboarding?plan=team")}`);
  await page.getByLabel("Full name").fill("Lea Owner");
  await page.getByLabel("Email", { exact: true }).fill(`lea-${run}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("owner-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Workspace name").fill(`Cloud ${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  // Chosen on the site: the new workspace goes on to its billing page
  await page.waitForURL(/\/settings\/billing$/);
  const billing = page.url();
  await expect(page.getByRole("heading", { name: "Community", level: 2 })).toBeVisible();
  await expect(main.getByText("Nobody has taken part in a meeting yet: you start with one seat.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Billing" })).toHaveAttribute("aria-current", "page");

  // Checkout left without paying: nothing changes, and the page says nothing was charged
  await page.getByRole("button", { name: "Move to Team, monthly" }).click();
  await expect(page.getByRole("heading", { name: "Fake Stripe Checkout" })).toBeVisible();
  await expect(page.getByText("1 × price_team_monthly")).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await expect(main.getByText("The payment was not completed: nothing was charged.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Community", level: 2 })).toBeVisible();

  // Paid: the webhook moves the workspace to Team, before the person is back
  await page.getByRole("button", { name: "Move to Team, monthly" }).click();
  await page.getByRole("button", { name: "Pay" }).click();
  await page.waitForURL(`${billing}?checkout=done`);
  await expect(main.getByText("Thank you! Your workspace moves to Team as soon as Stripe confirms the payment.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Team", level: 2 })).toBeVisible();
  await expect(main.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move to Team, monthly" })).toHaveCount(0);
  // The Checkout started first was closed before a new one opened: never two ways to pay twice
  expect(stripe.calls.filter((c) => /^POST \/v1\/checkout\/sessions\/[^/]+\/expire$/.test(c))).toHaveLength(1);

  // The portal, then cancelled there: back on Community
  await page.getByRole("button", { name: "Invoices and payment" }).click();
  await expect(page.getByRole("heading", { name: "Fake Stripe portal" })).toBeVisible();
  await expect(page.getByText("1 subscription(s)")).toBeVisible();
  await page.getByRole("button", { name: "Cancel the subscription" }).click();
  await page.waitForURL(billing);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Community", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move to Team, monthly" })).toBeVisible();
});
