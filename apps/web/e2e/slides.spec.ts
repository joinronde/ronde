import { expect, type Page, test } from "@playwright/test";
import { createMeeting, hostWithWorkspace, invite, joinWithNewAccount } from "./helpers";

// An irritants slide right after the intro: raised ahead from "My screen", shown on the stage, turned into an action

const run = Date.now().toString(36);
/** Screenshots for a visual review, only when SHOTS names a folder */
const shot = async (p: Page, name: string) => {
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/slides-${name}.png`, fullPage: true });
};

test("irritants raised before the meeting, dealt with right after the intro", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const workspace = await hostWithWorkspace(page, { name: "Sam Slide", email: `sam-${run}@example.com`, password: "slide-password-123" }, `Slides ${run}`);
  const link = await invite(page, workspace, `max-${run}@example.com`, "Max", "Mind");
  const meeting = await createMeeting(page, workspace, "Project review");

  // A slide goes right after the intro, where irritants are best raised
  await page.goto(`${meeting}/settings#agenda`);
  await page.getByRole("button", { name: "Add a block" }).click();
  await expect(page.getByRole("button", { name: /^Slide/ })).toContainText("irritants");
  await page.getByRole("button", { name: /^Slide/ }).click();
  const rows = page.locator(".agenda-blocks > li");
  await expect(rows.nth(0)).toContainText("Intro");
  await expect(rows.nth(1).getByLabel("Slide title")).toHaveValue("Irritants");
  await expect(rows.nth(1).getByLabel("What the slide is for")).toContainText("Irritants");
  await expect(page.getByText("Agenda saved")).toBeVisible();
  await shot(page, "0-agenda");

  // Before the meeting, with the check-in
  const max = await joinWithNewAccount(browser, link, { name: "Max Mind", email: `max-${run}@example.com`, password: "max-password-1234" });
  await max.goto(`${meeting}/me`);
  const panel = max.getByRole("region", { name: "Irritants" }).first();
  await panel.getByLabel("What gets in the way…").fill("Builds take 40 minutes");
  await panel.getByRole("button", { name: "Add" }).click();
  await expect(panel.getByRole("list", { name: "What you raised" })).toContainText("Builds take 40 minutes");
  await shot(max, "1-me");

  // On the stage at its step, then turned into an action from the control room
  await page.goto(`${meeting}/control`);
  await page.getByRole("button", { name: "Start the meeting" }).click();
  await page.getByRole("button", { name: /^Next: Irritants/ }).click();
  const wall = page.getByRole("list", { name: "Raised by the team" }).first();
  await expect(wall).toContainText("Builds take 40 minutes");
  await page.getByRole("button", { name: "Make it an action" }).click();
  await expect(page.getByText("Action created").first()).toBeVisible();
  await expect(wall.getByText("Action", { exact: true })).toBeVisible();
  await expect(page.getByText("Decided here (1)").first()).toBeVisible();
  await shot(page, "2-control");
  await max.getByRole("tab", { name: "Live" }).click();
  await expect(max.getByRole("list", { name: "Raised by the team" })).toContainText("Builds take 40 minutes");
  await shot(max, "3-live");
});
