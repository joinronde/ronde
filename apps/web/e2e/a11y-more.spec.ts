import { expect, test } from "@playwright/test";
import { audit } from "./axe";
import { createMeeting, fillCheckIn, hostWithWorkspace, invite, joinWithNewAccount, openTab } from "./helpers";

// Accessibility audit of the pages a11y.spec.ts does not reach: the signed-out pages of an invitation, a guest
// link and a password reset, the workspace's paid and admin pages, and a meeting while it is live and after it

const run = Date.now().toString(36);

test("the live meeting, its history and the other pages pass the accessibility audit", async ({ page, browser }) => {
  // Every page is compiled on its first visit by the dev server: the audit takes a while
  test.setTimeout(600_000);
  const workspace = await hostWithWorkspace(
    page,
    { name: "Ada Audit", email: `ada-${run}@example.com`, password: "audit-password-123" },
    `Audit more ${run}`,
  );
  const pia = await joinWithNewAccount(browser, await invite(page, workspace, `pia-${run}@example.com`, "Pia", "Part"), {
    name: "Pia Part",
    email: `pia-${run}@example.com`,
    password: "pia-password-1234",
  });
  // An invitation nobody opened yet, for the signed-out page
  const pending = await invite(page, workspace, `nora-${run}@example.com`, "Nora", "Noone");
  const meeting = await createMeeting(page, workspace, "Audit sync");

  // The workspace's admin pages; insights say which plan brings them
  await page.goto(`${workspace}/insights`);
  await expect(page.locator(".plan-notice")).toBeVisible();
  await audit(page, "insights (plan notice)");
  for (const tab of ["audit", "billing", "plans", "roles", "security"]) {
    // Billing and plans exist on a self-hosted instance too: its license and the plans it could have
    expect((await page.goto(`${workspace}/settings/${tab}`))?.status(), tab).toBe(200);
    await audit(page, `workspace settings: ${tab}`);
  }

  // Meeting settings: integrations; a guest link for later, polls on for the panes
  await page.goto(`${meeting}/settings#integrations`);
  await page.reload();
  await audit(page, "settings: integrations");
  await page.goto(`${meeting}/settings#people`);
  await page.getByRole("textbox", { name: "Who it is for" }).fill("Board");
  await page.getByRole("button", { name: "Create a link" }).click();
  const guestLink = await page.getByRole("textbox", { name: "Guest link" }).inputValue();
  await page.goto(`${meeting}/settings#modules`);
  await page.getByRole("switch", { name: "Use Polls in this meeting" }).click();
  await expect(page.getByText("Polls turned on")).toBeVisible();

  // Signed-out pages, in a browser with no account
  const visitor = await (await browser.newContext({ locale: "en-US" })).newPage();
  await visitor.goto("/forgot-password");
  await audit(visitor, "forgot password");
  await visitor.goto("/reset-password?token=not-a-token");
  await audit(visitor, "reset password");
  await visitor.goto(pending);
  await expect(visitor.getByRole("heading", { name: `Join Audit more ${run}` })).toBeVisible();
  await audit(visitor, "invitation");
  await visitor.goto(guestLink);
  await audit(visitor, "guest link");

  // Live: the control room's panes, the participant's live tab with its dock
  await pia.goto(`${meeting}/me`);
  await fillCheckIn(pia, ["Shipped the invoices", "Start the exports", "Waiting for the API keys"]);
  await pia.getByRole("textbox", { name: "Topic" }).fill("Office move");
  await pia.getByRole("button", { name: "Propose" }).click();
  await page.goto(`${meeting}/control`);
  await expect(async () => {
    await page.getByRole("button", { name: "▶ Start the meeting" }).click();
    await expect(page.getByRole("button", { name: /End the meeting/ })).toBeVisible({ timeout: 2000 });
  }).toPass();
  await pia.getByRole("button", { name: "✋ Raise my hand" }).first().click();
  for (const pane of ["Live", "Topics", "Actions", "Polls", "Minutes"]) {
    await openTab(page, new RegExp(`^${pane}`));
    await audit(page, `control room live: ${pane}`);
  }
  await openTab(pia, "Live meeting");
  await expect(pia.getByRole("button", { name: "💜 Thanks" })).toBeVisible();
  await audit(pia, "my screen: live with the dock");
  await visitor.goto(guestLink);
  await audit(visitor, "guest link, live");

  // The end and archive confirmations
  await page.goto(`${meeting}/control`);
  await page.getByRole("button", { name: /End the meeting/ }).click();
  await expect(page.getByRole("button", { name: "Yes, end it" })).toBeVisible();
  await audit(page, "end confirmation");
  await page.getByRole("button", { name: "Yes, end it" }).click();
  await page.getByRole("button", { name: "Archive the meeting" }).click();
  await expect(page.getByRole("button", { name: "Yes, archive" })).toBeVisible();
  await audit(page, "archive confirmation");
  await page.getByRole("button", { name: "Yes, archive" }).click();
  await expect(page.getByText("Meeting archived with its minutes. The next one is ready.")).toBeVisible();

  // After it: the history with its minutes, the stats with their data
  await page.goto(`${meeting}/history`);
  await expect(page.locator(".minutes-doc").getByText("Shipped the invoices")).toBeVisible();
  await audit(page, "history with an archived session");
  await page.goto(`${meeting}/stats`);
  const archived = page.locator(".kpi").filter({ has: page.locator(".l", { hasText: /^Archived meetings$/ }) });
  await expect(archived.locator(".v")).toHaveText("1");
  await audit(page, "stats with data");
  await pia.context().close();
  await visitor.context().close();
});
