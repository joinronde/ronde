import { expect, test } from "@playwright/test";
import { createWorkspace, invite } from "../helpers";
import { Inbox, signUpConfirmed } from "./inbox";

// An invitation waiting for an address: the invitation email arrives, and once the address is confirmed the
// onboarding page offers to join, without the link

const run = Date.now().toString(36);
const inbox = new Inbox();

test.beforeAll(async () => {
  await inbox.start();
});
test.afterAll(async () => {
  await inbox.stop();
});

test("a pending invitation is joined from the onboarding page once the address is confirmed", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const host = { name: "Owen Onboard", email: `owen-${run}@example.com`, password: "owner-password-123" };
  const nina = { name: "Nina Newcomer", email: `nina-${run}@example.com`, password: "nina-password-123" };
  await signUpConfirmed(page, inbox, host);
  const workspace = await createWorkspace(page, `Onboard ${run}`);
  const link = await invite(page, workspace, nina.email, "Nina", "Newcomer");

  // The invitation went out by email, with the same link
  expect(await inbox.link(nina.email, /Onboard/)).toBe(link);

  // Nina signs up on her own, not from the link: after confirming her address the invitation waits for her
  const ninaPage = await (await browser.newContext({ locale: "en-US" })).newPage();
  await signUpConfirmed(ninaPage, inbox, nina);
  const invitations = ninaPage.getByRole("region", { name: "You've been invited" });
  await expect(invitations).toContainText(`Onboard ${run}`);
  await expect(ninaPage.getByRole("heading", { name: "Or create your own workspace" })).toBeVisible();
  await invitations.getByRole("button", { name: "Join" }).click();
  await expect(ninaPage).toHaveURL(new RegExp(`${new URL(workspace).pathname}$`));
  await expect(ninaPage.getByRole("heading", { level: 1, name: /\bNina$/ })).toBeVisible();

  // Joined: the onboarding no longer offers it, the host's directory counts her in
  await ninaPage.goto("/onboarding");
  await expect(ninaPage.getByRole("region", { name: "You've been invited" })).toHaveCount(0);
  await ninaPage.context().close();
  await page.goto(`${workspace}/people`);
  await expect(page.getByRole("row", { name: /Nina Newcomer/ })).toContainText("Member");
});
