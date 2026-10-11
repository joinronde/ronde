import { expect, type Page, test } from "@playwright/test";
import { choose } from "./select";

// A poll and a planning poker round with a host and one participant, through the browsers

const run = Date.now().toString(36);

/** Screenshots for a visual review, only when SHOTS names a folder */
async function shot(p: Page, name: string) {
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/poker-${name}.png`, fullPage: true });
}

async function signUp(page: Page, name: string, email: string, path = "/sign-up") {
  await page.goto(path);
  await page.getByLabel("Full name").fill(name);
  if (await page.getByLabel("Email", { exact: true }).isEditable()) await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("poker-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
}

test("a poll and a planning poker round", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signUp(page, "Pia Poker", `pia-${run}@example.com`);
  await page.getByLabel("Workspace name").fill(`Poker ${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  await page.waitForURL(/\/w\/poker-/);
  const workspace = page.url();
  await page.goto(`${workspace}/people?invite=1`);
  const dialog = page.getByRole("dialog", { name: "Invite someone" });
  await dialog.getByLabel("Email", { exact: true }).fill(`max-${run}@example.com`);
  await dialog.getByLabel("First name").fill("Max");
  await dialog.getByLabel("Last name").fill("Mind");
  await dialog.getByRole("button", { name: "Send the invitation" }).click();
  const link = await page.getByRole("dialog", { name: "Invitation link" }).getByRole("textbox").inputValue();

  // Weekly sync with the planning poker module and its block before the open topics
  await page.goto(`${workspace}/meetings/new`);
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByLabel("Name").fill("Sprint planning");
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Create the meeting" }).click();
  await page.waitForURL(/\/m\/[^/]+\/control$/, { timeout: 120_000 });
  const meeting = page.url().replace(/\/control$/, "");
  await page.getByRole("button", { name: "Skip the tour" }).click();
  // The modules are turned on from the meeting's catalog, then the poker block goes on the agenda (saved by itself)
  await page.goto(`${meeting}/settings#modules`);
  for (const name of ["Planning poker", "Polls", "Random tools", "Parking lot"]) {
    // Clicked, not checked: the switch follows the meeting's state once the server has it
    await page.getByRole("switch", { name: `Use ${name} in this meeting` }).click();
    await expect(page.getByText(`${name} turned on`)).toBeVisible();
  }
  await page.goto(`${meeting}/settings#agenda`);
  await choose(page, page.getByLabel("Add a block"), "poker");
  await page.getByRole("button", { name: "Move “Planning poker” up" }).click();
  await expect(page.getByText("Agenda saved")).toBeVisible();

  const max = await (await browser.newContext({ locale: "en-US" })).newPage();
  await max.goto(link);
  await max.getByRole("link", { name: "Create an account" }).click();
  await max.waitForURL(/\/sign-up\?/);
  await signUp(max, "Max Mind", `max-${run}@example.com`, max.url());
  await max.getByRole("button", { name: /^Join / }).click();
  await max.waitForURL(/\/w\/[^/]+$/);

  // Poll: asked from the control room, answered by Max, shown on the screen
  await page.goto(`${meeting}/control`);
  await page.getByRole("button", { name: "Start the meeting" }).click();
  await max.goto(`${meeting}/me`);
  await max.getByRole("tab", { name: "Live" }).click();
  await page.getByRole("tab", { name: /^Polls/ }).click();
  await page.getByLabel("Question").fill("Ready for the sprint?");
  await page.getByLabel("Choices, one per line").fill("Yes\nNo");
  await page.getByRole("button", { name: "Ask the team" }).click();
  await max.getByRole("radio", { name: "Yes" }).check();
  await max.locator(".poll-answer").getByRole("button", { name: "Answer" }).click();
  await expect(page.locator(".poll-host").getByText("1 answer")).toBeVisible();
  await page.getByRole("button", { name: "Show on the shared screen" }).click();
  await expect(max.locator(".poll-band").getByRole("heading", { name: "Ready for the sprint?" })).toBeVisible();
  await shot(page, "1-poll-control");
  await shot(max, "1-poll-me");

  // Random tools: the wheel spins on every screen and lands on the same person
  await page.getByRole("tab", { name: "Random" }).click();
  await page.getByRole("button", { name: "Spin" }).click();
  await expect(max.locator(".draw-band .draw-result")).toHaveText(/^(Pia|Max) \w+!$/, { timeout: 10_000 });
  await shot(max, "0-wheel");
  await page.getByRole("button", { name: /speaks next$/ }).click();
  await expect(page.getByText("✓ Applied to the speaking order")).toBeVisible();
  await page.getByRole("button", { name: "Hide from the screens" }).click();
  await expect(max.locator(".draw-band")).toHaveCount(0);

  // Planning poker: an item, a hidden card, the reveal and the estimate
  const next = page.getByRole("button", { name: /^Next: / });
  for (;;) {
    const label = (await next.textContent()) ?? "";
    await next.click();
    if (label.includes("Planning poker")) break;
    await expect(next).not.toHaveText(label);
  }
  await page.getByLabel("Item to estimate").fill("Login with SSO");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await max.getByRole("radio", { name: "5" }).click();
  await expect(page.getByText("1 of 2 have picked a card")).toBeVisible();
  await shot(max, "2-pick");
  await page.getByRole("button", { name: "Reveal the cards" }).click();
  await expect(max.locator(".poker-table").getByText("5")).toBeVisible();
  await shot(page, "3-revealed-control");
  await page.locator(".poker-deck.small").getByRole("button", { name: "5", exact: true }).click();
  await expect(max.getByText("Estimate: 5")).toBeVisible();
  await page.getByRole("textbox", { name: "Notes · Host" }).fill("Decision: SSO ships in the next sprint");
  await page.waitForTimeout(1500);

  // Parking lot: a subject set aside for the next session
  await page.getByRole("tab", { name: /^Topics/ }).click();
  await page.getByLabel("Subject to set aside").fill("Office move");
  await page.getByRole("button", { name: "Park it" }).click();
  await expect(page.locator(".parking").getByText("Office move")).toBeVisible();

  // Archived: the estimate and the poll in the minutes
  await page.getByRole("button", { name: /End the meeting/ }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();
  await page.getByRole("button", { name: "Archive the meeting" }).click();
  await page.getByRole("button", { name: "Yes, archive" }).click();
  await page.goto(`${meeting}/history`);
  await expect(page.locator(".minutes-sec").filter({ hasText: "Estimates" }).getByText("Login with SSO")).toBeVisible();
  await shot(page, "4-minutes");
  await expect(page.locator(".minutes-sec").filter({ hasText: "Polls" }).getByText("Ready for the sprint?")).toBeVisible();
  await expect(page.locator(".minutes-sec").filter({ hasText: "Parking lot" }).getByText("Office move")).toBeVisible();

  // Decision log, open to the participants
  await max.goto(`${meeting}/me`);
  await max.getByRole("tab", { name: "Decisions" }).click();
  await expect(max.locator(".decision-day").getByText("SSO ships in the next sprint")).toBeVisible();
  await shot(max, "5-decisions");
  await max.context().close();
});
