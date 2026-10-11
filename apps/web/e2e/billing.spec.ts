import { expect, test } from "@playwright/test";

// The billing page of the cloud (RONDE_CLOUD=1 with Stripe keys): a new workspace is on Community and
// can move to Team. Skipped on a self-hosted run.

const run = Date.now().toString(36);

test.skip(!process.env.RONDE_CLOUD, "cloud only");

test("a new workspace of the cloud starts on Community, with the way to Team", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/sign-up?next=${encodeURIComponent("/onboarding?plan=team")}`);
  await page.getByLabel("Full name").fill("Lea Owner");
  await page.getByLabel("Email", { exact: true }).fill(`lea-${run}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("owner-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Workspace name").fill(`Cloud ${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  // Chosen on the site: the new workspace goes on to its billing page
  await page.waitForURL(/\/settings\/billing$/);
  await expect(page.getByRole("heading", { name: "Community", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move to Team, monthly" })).toBeVisible();
  await expect(page.getByText("Nobody has taken part in a meeting yet: you start with one seat.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Billing" })).toHaveAttribute("aria-current", "page");
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/billing.png`, fullPage: true });
});
