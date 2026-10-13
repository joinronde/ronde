import { expect, test } from "@playwright/test";
import { createMeeting, fillCheckIn, hostWithWorkspace, invite, joinWithNewAccount, openTab } from "./helpers";

// A participant's side of a session: a check-in saved from two tabs, the bar that tells when their turn comes,
// a question and a thank-you from the dock, the rating at the end, and last time's plans back afterwards

const run = Date.now().toString(36);

test("a participant's session, from two tabs of check-in to last time's plans", async ({ page, browser }) => {
  test.setTimeout(600_000);
  const workspace = await hostWithWorkspace(
    page,
    { name: "Hugo Host", email: `hugo-${run}@example.com`, password: "host-password-123" },
    `Participant ${run}`,
  );
  const pia = await joinWithNewAccount(browser, await invite(page, workspace, `pia-${run}@example.com`, "Pia", "Part"), {
    name: "Pia Part",
    email: `pia-${run}@example.com`,
    password: "pia-password-1234",
  });
  const leoLink = await invite(page, workspace, `leo-${run}@example.com`, "Leo", "Lane");
  const leo = await joinWithNewAccount(browser, leoLink, {
    name: "Leo Lane",
    email: `leo-${run}@example.com`,
    password: "leo-password-1234",
  });
  await leo.context().close();
  const meeting = await createMeeting(page, workspace, "Participant sync");

  // Two tabs of the same check-in: the second one saved is told, and keeps both
  await pia.goto(`${meeting}/me`);
  await fillCheckIn(pia, ["Shipped the invoices", "Start the exports"]);
  // The second tab is being written in when the first one saves: a clean tab would simply take the new
  // version live, with nothing to merge
  const other = await pia.context().newPage();
  await other.goto(`${meeting}/me`);
  await other.getByRole("textbox", { name: "Other" }).fill("From the second tab");
  await pia.getByRole("textbox", { name: "Other" }).fill("From the first tab");
  await pia.getByRole("button", { name: "Save my check-in" }).click();
  await expect(pia.getByText("Unsaved changes")).toHaveCount(0);
  await other.getByRole("button", { name: "Save my check-in" }).click();
  await expect(other.getByText(/Your check-in was changed elsewhere while you were writing/)).toBeVisible();
  await expect(other.getByRole("group", { name: "Other" })).toContainText("From the first tab");
  // Saved again at once, the merge reviewed: one click is enough
  await other.getByRole("button", { name: "Save my check-in" }).click();
  await expect(other.getByText("Unsaved changes")).toHaveCount(0);
  await other.close();
  await pia.reload();
  const others = pia.getByRole("group", { name: "Other" });
  await expect(others).toContainText("From the first tab");
  await expect(others).toContainText("From the second tab");
  await expect(pia.getByRole("group", { name: "Done this week" })).toContainText("Shipped the invoices");

  // Live: the bar on Pia's other tabs says when her turn comes
  await page.goto(`${meeting}/control`);
  await expect(async () => {
    await page.getByRole("button", { name: "▶ Start the meeting" }).click();
    await expect(page.getByRole("button", { name: /End the meeting/ })).toBeVisible({ timeout: 2000 });
  }).toPass();
  // The start brings Pia's screen to the live meeting; the bar shows on her other tabs
  await expect(pia.getByRole("tab", { name: "Live meeting" })).toHaveAttribute("aria-selected", "true");
  const bar = pia.locator(".livebar");
  await expect(bar).toHaveCount(0);
  await openTab(pia, "My check-in");
  await expect(bar.locator(".pill.live")).toBeVisible();
  // Pia speaks last of the three in the round: two before her
  await expect(bar.getByRole("status")).toHaveText(/^\d more (person|people) before you$/);
  const next = page.getByRole("button", { name: /^Next: / });
  while (!((await next.textContent()) ?? "").includes("Pia")) {
    const label = (await next.textContent()) ?? "";
    await next.click();
    await expect(next).not.toHaveText(label);
  }
  await expect(bar.getByRole("status")).toHaveText(/^You speak (after \w+|right after)$/);
  await openTab(pia, "Team check-ins");
  await expect(bar.getByRole("status")).toHaveText(/^You speak (after \w+|right after)$/);
  await next.click();
  await expect(bar.getByRole("status")).toHaveText("It's your turn!");
  await openTab(pia, "My check-in");
  await expect(bar.getByRole("status")).toHaveText("It's your turn!");
  await expect(bar.getByRole("button", { name: "✋ Raise my hand" })).toBeVisible();

  // The dock, on the Live tab: a question the host sees, thanks to Leo shown on the screen and the wall
  const screen = await page.context().newPage();
  await screen.goto(`${meeting}/screen`);
  await openTab(pia, "Live meeting");
  await pia.getByRole("textbox", { name: "Question" }).fill("When is the release?");
  await pia.getByRole("button", { name: "Send", exact: true }).click();
  await expect(pia.getByText("Question sent. It will be handled after this turn.")).toBeVisible();
  await openTab(page, /^Live/);
  const live = page.getByRole("tabpanel");
  await expect(live.locator(".item").filter({ hasText: "When is the release?" })).toBeVisible();
  await live.getByRole("button", { name: "✓ Mark as answered" }).click();
  await expect(live.getByRole("heading", { name: "Pending (0)" })).toBeVisible();

  await pia.getByRole("button", { name: "💜 Thanks" }).click();
  await pia.locator("#kudoTo").click();
  await pia.getByRole("option", { name: /Leo/ }).click();
  await pia.getByRole("textbox", { name: "Message" }).fill("Thanks for the review of the exports");
  await pia.getByRole("button", { name: "Send", exact: true }).click();
  await expect(pia.getByText("Thanks sent: it shows on the shared screen.")).toBeVisible();
  await expect(screen.getByText("Thanks for the review of the exports")).toBeVisible();
  await expect(live.getByRole("heading", { name: "Kudos (1)" })).toBeVisible();
  await screen.close();

  // At the end, Pia rates the meeting; she can change her mind
  await page.getByRole("button", { name: /End the meeting/ }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();
  const rating = pia.getByRole("region", { name: "How useful was this meeting for you?" });
  await expect(rating).toBeVisible();
  await rating.getByRole("button", { name: "4/5 · Useful" }).click();
  await expect(rating.getByRole("button", { name: "4/5 · Useful" })).toHaveAttribute("aria-pressed", "true");
  await expect(rating.getByRole("status")).toHaveText("Thanks! You can change your rating until the meeting is archived.");
  await rating.getByRole("button", { name: "5/5 · Excellent" }).click();
  await expect(rating.getByRole("button", { name: "5/5 · Excellent" })).toHaveAttribute("aria-pressed", "true");
  await expect(rating.getByRole("button", { name: "4/5 · Useful" })).toHaveAttribute("aria-pressed", "false");

  await openTab(page, /^Minutes/);
  await page.getByRole("button", { name: "Archive the meeting" }).click();
  await page.getByRole("button", { name: "Yes, archive" }).click();
  await expect(page.getByText("Meeting archived with its minutes. The next one is ready.")).toBeVisible();

  // The kudos wall of the workspace keeps the thanks
  await page.goto(`${workspace}/kudos`);
  await expect(page.getByRole("main")).toContainText("Thanks for the review of the exports");

  // Next week: what Pia planned comes back, to tick off or carry over
  await pia.goto(`${meeting}/me`);
  await expect(pia.getByRole("status").filter({ hasText: "item planned last time: done or carried over?" })).toBeVisible();
  const item = pia
    .getByRole("listitem")
    .filter({ hasText: "Start the exports" })
    .filter({ has: pia.getByRole("button", { name: "↻ Carry over" }) });
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "↻ Carry over" }).click();
  await expect(pia.getByRole("listitem").filter({ hasText: "Start the exports" }).filter({ hasText: "Carried over" })).toBeVisible();
  await expect(pia.getByRole("group", { name: "Planned for next week" })).toContainText("Start the exports");
  await pia.getByRole("button", { name: "Save my check-in" }).click();
  await expect(pia.getByText("Unsaved changes")).toHaveCount(0);
  await pia.reload();
  await expect(pia.getByRole("group", { name: "Planned for next week" })).toContainText("Start the exports");
  await pia.context().close();
});
