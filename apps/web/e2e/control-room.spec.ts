import { expect, type Page, test } from "@playwright/test";
import { createMeeting, fillCheckIn, hostWithWorkspace, invite, joinWithNewAccount, openTab } from "./helpers";
import { choose } from "./select";

// The control room in a session with two participants: the order of the turns, absences, the timer and the
// keyboard, the panes (actions, live, topics, minutes), a check-in fixed by the host, then the history

const run = Date.now().toString(36);

/** The step on air, as the control room's deck shows it */
const now = (page: Page) => page.locator(".what h2").first();

/** Keys go to the page, not to the button clicked last (Space would press it) */
async function key(page: Page, name: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(name);
}

async function start(page: Page) {
  // Clicked again until it holds: the click can come before the control room is ready
  await expect(async () => {
    await page.getByRole("button", { name: "▶ Start the meeting" }).click();
    await expect(page.getByRole("button", { name: /End the meeting/ })).toBeVisible({ timeout: 2000 });
  }).toPass();
}

test("the host runs a session from the control room, from the order of the turns to the history", async ({ page, browser }) => {
  test.setTimeout(600_000);
  const workspace = await hostWithWorkspace(
    page,
    { name: "Cora Control", email: `cora-${run}@example.com`, password: "control-password-123" },
    `Control ${run}`,
  );
  const pia = await joinWithNewAccount(browser, await invite(page, workspace, `pia-${run}@example.com`, "Pia", "Part"), {
    name: "Pia Part",
    email: `pia-${run}@example.com`,
    password: "pia-password-1234",
  });
  const dan = await joinWithNewAccount(browser, await invite(page, workspace, `dan-${run}@example.com`, "Dan", "Dorsey"), {
    name: "Dan Dorsey",
    email: `dan-${run}@example.com`,
    password: "dan-password-1234",
  });
  const meeting = await createMeeting(page, workspace, "Control sync");

  // Pia's check-in has a blocker and she proposes a topic
  await pia.goto(`${meeting}/me`);
  await fillCheckIn(pia, ["Shipped the invoices", "Start the exports", "Waiting for the API keys"]);
  await pia.getByRole("textbox", { name: "Topic" }).fill("Office move");
  await pia.getByRole("button", { name: "Propose" }).click();
  await dan.context().close();

  await page.goto(`${meeting}/control`);
  const agenda = page.getByRole("tabpanel").getByRole("listitem");
  const row = (name: string) => agenda.filter({ hasText: name });
  // The intro, three turns, the open topics and the wrap-up
  await expect(agenda).toHaveCount(6);

  // Order: Cora, first, moves down one place; the shuffle says what it did
  await expect(agenda.nth(1)).toContainText("Cora Control");
  const second = (await agenda.nth(2).textContent())!.includes("Pia") ? "Pia Part" : "Dan Dorsey";
  await row("Cora Control").getByRole("button", { name: "Move down" }).click();
  await expect(agenda.nth(1)).toContainText(second);
  await expect(agenda.nth(2)).toContainText("Cora Control");
  await page.getByRole("button", { name: "Shuffle" }).click();
  await expect(page.getByText("Order shuffled for those who have not spoken yet")).toBeVisible();

  // Dan is away: marked absent, his turn is skipped
  await row("Dan Dorsey").getByRole("button", { name: "Absent" }).click();
  await expect(row("Dan Dorsey").getByRole("button", { name: "Present" })).toBeVisible();

  await start(page);
  await expect(now(page)).toHaveText("Introduction");
  const turns: string[] = [];
  const next = page.getByRole("button", { name: /^Next: / });
  for (let i = 0; i < 2; i++) {
    const label = (await next.textContent()) ?? "";
    await next.click();
    await expect(next).not.toHaveText(label);
    turns.push((await now(page).textContent()) ?? "");
  }
  // In the shuffled order, Dan skipped
  expect([...turns].sort()).toEqual(["Cora Control", "Pia Part"]);
  await expect(next).toHaveText(/^Next: Open topics/);

  // Back, with the button then with the keyboard; forward with →
  await page.getByRole("button", { name: "← Previous" }).click();
  await expect(now(page)).toHaveText(turns[0]!);
  await key(page, "ArrowLeft");
  await expect(now(page)).toHaveText("Introduction");
  await key(page, "ArrowRight");
  await expect(now(page)).toHaveText(turns[0]!);

  // Present again: Dan's turn comes back among the upcoming ones
  await row("Dan Dorsey").getByRole("button", { name: "Present" }).click();
  await expect(row("Dan Dorsey").getByRole("button", { name: "Absent" })).toBeVisible();
  // "Go" jumps straight to a step
  await row("Dan Dorsey").getByRole("button", { name: "Go" }).click();
  await expect(now(page)).toHaveText("Dan Dorsey");

  // Timer: pause and resume with the button and Space, 30 more seconds for the speaker
  await page.getByRole("button", { name: "⏸ Pause" }).click();
  await expect(page.getByRole("button", { name: "▶ Timer" })).toBeVisible();
  await page.getByRole("button", { name: "▶ Timer" }).click();
  await expect(page.getByRole("button", { name: "⏸ Pause" })).toBeVisible();
  await key(page, "Space");
  await expect(page.getByRole("button", { name: "▶ Timer" })).toBeVisible();
  await key(page, "Space");
  await expect(page.getByRole("button", { name: "⏸ Pause" })).toBeVisible();
  await page.getByRole("button", { name: "+30 s" }).click();
  await expect(page.getByText("30 more seconds for Dan")).toBeVisible();

  // Cancel the start: back to the waiting screen, check-ins kept
  await page.getByRole("button", { name: "Cancel the start" }).click();
  await page.getByRole("group", { name: "Confirmation" }).getByRole("button", { name: "Yes, back to waiting" }).click();
  await expect(page.getByText("Start cancelled: back to the waiting screen.")).toBeVisible();
  await expect(page.getByRole("button", { name: "▶ Start the meeting" })).toBeVisible();
  await expect(now(page)).toHaveText("Introduction");

  // The host fixes Pia's check-in: she sees it on her screen
  await row("Pia Part").getByRole("button", { name: "Check-in" }).click();
  const fix = page.getByRole("dialog");
  await expect(fix.getByText("You are editing Pia's check-in")).toBeVisible();
  await fix.getByRole("textbox", { name: "Other" }).fill("Fixed by the host");
  await fix.getByRole("button", { name: "Save Pia's check-in" }).click();
  await expect(page.getByText("Pia's check-in saved")).toBeVisible();
  await expect(fix).toHaveCount(0);
  await pia.reload();
  await expect(pia.getByRole("group", { name: "Other" })).toContainText("Fixed by the host");

  await start(page);

  // Actions: the blocker becomes an action, a new one for Pia changes status, the first one is deleted
  await openTab(page, /^Actions/);
  const pane = page.getByRole("tabpanel");
  await pane.getByRole("button", { name: "Create an action" }).click();
  await expect(page.getByText("Follow-up action created").first()).toBeVisible();
  await expect(pane.getByText("Already tracked")).toBeVisible();
  await pane.getByRole("textbox", { name: "New action" }).fill("Book the room");
  await choose(page, pane.locator("form").getByRole("combobox", { name: "Owner" }), await ownerValue(page, pane, "Pia"));
  await pane.getByRole("button", { name: "Add", exact: true }).click();
  const booked = pane.locator(".item").filter({ hasText: "Book the room" });
  await expect(booked).toBeVisible();
  await expect(booked.getByRole("combobox", { name: "Owner" })).toContainText("Pia Part");
  await choose(page, booked.getByRole("combobox", { name: "Status" }), "doing");
  await expect(booked.getByRole("combobox", { name: "Status" })).toContainText("In progress");
  const keys = pane
    .locator(".item")
    .filter({ hasText: "Waiting for the API keys" })
    .filter({ has: page.getByRole("combobox") });
  await keys.getByRole("button", { name: "Delete" }).click();
  await keys.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(keys).toHaveCount(0);
  await expect(pane.getByRole("button", { name: "Create an action" })).toBeVisible();

  // Live: Pia raises her hand, the host gives her the floor
  await pia.getByRole("tab", { name: "Live" }).click();
  await pia.getByRole("button", { name: "Raise my hand" }).click();
  await openTab(page, /^Live/);
  await expect(pane.getByRole("heading", { name: "Pending (1)" })).toBeVisible();
  await pane.getByRole("button", { name: "✓ Floor given" }).click();
  await expect(pane.getByRole("heading", { name: "Pending (0)" })).toBeVisible();
  await expect(pane.getByRole("heading", { name: "Handled" })).toBeVisible();

  // Topics: Pia's shown big on the shared screen then handled; one of the host's deleted
  await openTab(page, /^Topics/);
  await pane.getByRole("textbox", { name: "New topic" }).fill("Coffee machine");
  await pane.getByRole("button", { name: "Add", exact: true }).click();
  const office = pane.locator(".item").filter({ hasText: "Office move" });
  const coffee = pane.locator(".item").filter({ hasText: "Coffee machine" });
  await expect(coffee).toBeVisible();
  // Shown big only with the Spotlight module, off in a weekly sync: turned on from another tab, the pane follows
  await expect(office.getByRole("button", { name: "Show big on screen" })).toHaveCount(0);
  const settings = await page.context().newPage();
  await settings.goto(`${meeting}/settings#modules`);
  await settings.getByRole("switch", { name: "Use Spotlight in this meeting" }).click();
  await expect(settings.getByText("Spotlight turned on")).toBeVisible();
  await settings.close();
  await office.getByRole("button", { name: "Show big on screen" }).click();
  await expect(page.locator(".preview-frame")).toContainText("Office move");
  // Ticked once the server has it: clicked, not checked
  await office.getByRole("checkbox", { name: "Topic handled" }).click();
  await expect(office.getByRole("checkbox", { name: "Topic handled" })).toBeChecked();
  await coffee.getByRole("button", { name: "Remove" }).click();
  await expect(coffee).toHaveCount(0);

  // End, then the minutes without the open topics, previewed, then archived
  await page.getByRole("button", { name: /End the meeting/ }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();
  await expect(page.getByText("Meeting ended: review the minutes, then archive them.")).toBeVisible();
  await openTab(page, /^Minutes/);
  await pane.getByText("Content:").click();
  await pane.getByRole("checkbox", { name: "Open topics" }).uncheck();
  await expect(pane.getByText("Content:")).toContainText("9 of 10 team inputs");
  await pane.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByRole("dialog");
  await expect(preview).toContainText("Shipped the invoices");
  await expect(preview).not.toContainText("Office move");
  await preview.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Archive the meeting" }).click();
  await page.getByRole("button", { name: "Yes, archive" }).click();
  await expect(page.getByText("Meeting archived with its minutes. The next one is ready.")).toBeVisible();

  // History: the omitted part is missing; a summary added afterwards; search
  await page.goto(`${meeting}/history`);
  const minutes = page.locator(".minutes-doc");
  await expect(minutes.getByText("Shipped the invoices")).toBeVisible();
  await expect(minutes.getByText("Office move")).toHaveCount(0);
  await page.getByRole("button", { name: "Add a summary" }).click();
  const summary = page.getByRole("dialog");
  await summary.getByRole("textbox", { name: "Summary" }).fill("The invoices rollout went well.");
  await summary.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Summary saved")).toBeVisible();
  await page.reload();
  await expect(minutes.getByText("The invoices rollout went well.")).toBeVisible();
  await page.getByRole("button", { name: "Edit the summary" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Summary" }).fill("The invoices rollout went very well.");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(minutes.getByText("The invoices rollout went very well.")).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search the minutes" });
  await search.fill("rollout");
  await expect(page.getByText("1 meeting found")).toBeVisible();
  await search.fill("zeppelin");
  await expect(page.getByText("No minutes contain “zeppelin”.")).toBeVisible();

  // Pia finds her action on her home page and marks it done
  await pia.goto(workspace);
  const mine = pia.getByRole("region", { name: /My actions/ });
  await expect(mine).toContainText("Book the room");
  await mine.getByRole("button", { name: "Mark “Book the room” as done" }).click();
  await expect(mine.getByText("Book the room")).toHaveCount(0);
  await pia.goto(`${workspace}/actions`);
  await expect(pia.getByRole("main")).toContainText("Book the room");
  await pia.context().close();
});

/** The value of an owner in the new action's drawn select, found by the person's first name */
async function ownerValue(page: Page, pane: ReturnType<Page["getByRole"]>, firstName: string): Promise<string> {
  const select = pane.locator("form").getByRole("combobox", { name: "Owner" });
  await select.click();
  const value = await page.locator('[role="listbox"] [role="option"]').filter({ hasText: firstName }).getAttribute("data-value");
  await page.keyboard.press("Escape");
  return value!;
}
