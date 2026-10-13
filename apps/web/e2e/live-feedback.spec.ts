import { expect, type Page, test } from "@playwright/test";

// What hosts asked for after using the live meeting, through the browsers: a yes or no in one click, the host's
// votes, a thumbs up and "me too" on someone's lines, and focus that only quiets one's own screen

const run = Date.now().toString(36);

async function signUp(page: Page, name: string, email: string, path = "/sign-up") {
  await page.goto(path);
  await page.getByLabel("Full name").fill(name);
  if (await page.getByLabel("Email", { exact: true }).isEditable()) await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("live-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
}

test("the live meeting, as hosts asked for it", async ({ page, browser }) => {
  test.setTimeout(480_000);
  await signUp(page, "Lea Live", `lea-${run}@example.com`);
  await page.getByLabel("Workspace name").fill(`Feedback ${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  await page.waitForURL(/\/w\/feedback-/);
  const workspace = page.url();
  await page.goto(`${workspace}/people?invite=1`);
  const dialog = page.getByRole("dialog", { name: "Invite someone" });
  await dialog.getByLabel("Email", { exact: true }).fill(`max-${run}@example.com`);
  await dialog.getByLabel("First name").fill("Max");
  await dialog.getByLabel("Last name").fill("Mind");
  await dialog.getByRole("button", { name: "Send the invitation" }).click();
  const link = await page.getByRole("dialog", { name: "Invitation link" }).getByRole("textbox").inputValue();

  await page.goto(`${workspace}/meetings/new`);
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByLabel("Name").fill("Weekly sync");
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Create the meeting" }).click();
  await page.waitForURL(/\/m\/[^/]+\/control$/, { timeout: 120_000 });
  const meeting = page.url().replace(/\/control$/, "");
  await page.getByRole("button", { name: "Skip the tour" }).click();
  await page.goto(`${meeting}/settings#modules`);
  await page.getByRole("switch", { name: "Use Polls in this meeting" }).click();
  await expect(page.getByText("Polls turned on")).toBeVisible();

  // Max joins and writes his check-in
  const max = await (await browser.newContext({ locale: "en-US" })).newPage();
  await max.goto(link);
  await max.getByRole("link", { name: "Create an account" }).click();
  await max.waitForURL(/\/sign-up\?/);
  await signUp(max, "Max Mind", `max-${run}@example.com`, max.url());
  await max.getByRole("button", { name: /^Join / }).click();
  await max.waitForURL(/\/w\/[^/]+$/);
  await max.goto(`${meeting}/me`);
  await max
    .getByPlaceholder(/Add an item/)
    .first()
    .fill("Shipped the login page");
  await max.getByRole("button", { name: "Save my check-in" }).click();
  await expect(max.getByText("Unsaved changes")).toHaveCount(0);
  await max.getByRole("textbox", { name: "Topic" }).fill("Office move");
  await max.getByRole("button", { name: "Propose" }).click();

  // The host votes on the topics like everyone, and sees the votes left
  await page.goto(`${meeting}/control`);
  await page.getByRole("button", { name: "Start the meeting" }).click();
  await expect(page.getByRole("button", { name: /End the meeting/ })).toBeVisible();
  // Clicked again until it holds: the control room may still be settling after the start
  await expect(async () => {
    await page.getByRole("tab", { name: /^Topics/ }).click();
    await expect(page.getByRole("tab", { name: /^Topics/ })).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
  }).toPass();
  await expect(page.getByText("3 votes left out of 3")).toBeVisible();
  await page.getByRole("button", { name: "Vote for this topic" }).click();
  await expect(page.getByText("2 votes left out of 3")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove my vote" })).toHaveAttribute("aria-pressed", "true");

  // A yes or no in one click: on every screen at once, answers in green and red
  await max.getByRole("tab", { name: "Live" }).click();
  await page.getByRole("tab", { name: /^Polls/ }).click();
  await expect(page.getByRole("tab", { name: /^Polls/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /Yes or no, now/ }).click();
  await max.getByRole("radio", { name: "Yes" }).check();
  await max.locator(".poll-answer").getByRole("button", { name: "Answer" }).click();
  await expect(page.locator(".poll-host").getByText("1 answer")).toBeVisible();
  const screen = await page.context().newPage();
  await screen.goto(`${meeting}/screen`);
  await expect(screen.locator(".poll-bars.yesno")).toBeVisible();

  // Max's turn: the host, from their own screen, likes his line and joins it
  const next = page.getByRole("button", { name: /^Next: / });
  for (;;) {
    const label = (await next.textContent()) ?? "";
    await next.click();
    if (label.includes("Max")) break;
    await expect(next).not.toHaveText(label);
  }
  const lea = await page.context().newPage();
  await lea.goto(`${meeting}/me`);
  await lea.getByRole("tab", { name: "Live" }).click();
  await lea.getByRole("button", { name: "Me too on “Shipped the login page”" }).click();
  await expect(lea.getByRole("button", { name: "Stop showing on “Shipped the login page”" })).toHaveAttribute("aria-pressed", "true");
  await lea.locator(".line-actions .vote-btn").first().click();
  await expect(lea.locator(".line-actions .vote-btn").first()).toHaveAttribute("aria-pressed", "true");

  // During his turn, focus is on by itself on Max's screen only: reactions still fly on the shared screen (on a
  // computer the reactions are in the dock, no tray to open)
  const focus = max.getByRole("button", { name: "Focus" });
  await expect(focus).toHaveAttribute("aria-pressed", "true");
  await expect(focus).toHaveAttribute("aria-disabled", "true");
  await lea.getByRole("button", { name: "Well done" }).click();
  await expect(screen.locator(".fly").first()).toBeVisible();
  await expect(max.locator(".fly")).toHaveCount(0);
  await max.context().close();
});
