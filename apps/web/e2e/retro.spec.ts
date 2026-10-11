import { type Browser, expect, type Page, test } from "@playwright/test";

// A retrospective with three people: two write anonymous notes, the host reveals and groups them, everyone
// votes, the most voted group is discussed, and the minutes are archived

const run = Date.now().toString(36);
/** Screenshots for a visual review, only when SHOTS names a folder */
const shot = async (p: Page, name: string) => {
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/retro-${name}.png`, fullPage: true });
};
const host = { name: "Rita Retro", email: `rita-${run}@example.com`, password: "retro-password-123" };
const people = [
  { first: "Ana", last: "One", email: `ana-${run}@example.com`, password: "ana-password-1234" },
  { first: "Ben", last: "Two", email: `ben-${run}@example.com`, password: "ben-password-1234" },
];

async function signUp(page: Page, name: string, email: string, password: string, path = "/sign-up") {
  await page.goto(path);
  await page.getByLabel("Full name").fill(name);
  if (await page.getByLabel("Email", { exact: true }).isEditable()) await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}

async function joins(browser: Browser, url: string, who: (typeof people)[number]) {
  const page = await (await browser.newContext({ locale: "en-US" })).newPage();
  await page.goto(url);
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.waitForURL(/\/sign-up\?/);
  await signUp(page, `${who.first} ${who.last}`, who.email, who.password, page.url());
  await page.getByRole("button", { name: /^Join / }).click();
  await page.waitForURL(/\/w\/[^/]+$/);
  return page;
}

test("a retrospective with three people, from the notes to the minutes", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signUp(page, host.name, host.email, host.password);
  await page.getByLabel("Workspace name").fill(`Retro ${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  await page.waitForURL(/\/w\/retro-/);
  const workspace = page.url();

  // Invitations, then the meeting from the monthly retrospective template
  const links: string[] = [];
  for (const p of people) {
    await page.goto(`${workspace}/people?invite=1`);
    const dialog = page.getByRole("dialog", { name: "Invite someone" });
    await dialog.getByLabel("Email", { exact: true }).fill(p.email);
    await dialog.getByLabel("First name").fill(p.first);
    await dialog.getByLabel("Last name").fill(p.last);
    await dialog.getByRole("button", { name: "Send the invitation" }).click();
    links.push(await page.getByRole("dialog", { name: "Invitation link" }).getByRole("textbox").inputValue());
  }
  await page.goto(`${workspace}/meetings/new`);
  await page.getByText("Monthly retrospective", { exact: true }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByLabel("Name").fill("Team retro");
  await page.getByLabel("I also take a turn in the round table").uncheck();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Create the meeting" }).click();
  await page.waitForURL(/\/m\/[^/]+\/control$/, { timeout: 120_000 });
  const meeting = page.url().replace(/\/control$/, "");
  await page.getByRole("button", { name: "Skip the tour" }).click();

  const [ana, ben] = [await joins(browser, links[0]!, people[0]!), await joins(browser, links[1]!, people[1]!)];
  for (const p of [ana, ben]) await p.goto(`${meeting}/me`);

  // Writing: anonymous notes, nobody sees the others' before the reveal
  await page.getByRole("button", { name: "Start the meeting" }).click();
  await page.getByRole("button", { name: /^Next: Retro: write/ }).click();
  for (const [p, column, text] of [
    [ana, "To improve", "Deploys are slow"],
    [ben, "To improve", "Too many manual steps to release"],
    [ben, "Went well", "Great onboarding"],
  ] as const) {
    await p.getByRole("tab", { name: "Live" }).click();
    await p.getByLabel(`New note in “${column}”`).fill(text);
    await p.getByLabel(`New note in “${column}”`).press("Enter");
    await expect(p.getByText(text)).toBeVisible();
  }
  await expect(ana.getByText("Too many manual steps to release")).toHaveCount(0);
  await expect(page.getByText("2 of 2 people have written")).toBeVisible();
  await shot(ana, "1-write");
  await shot(page, "1-control");

  // Reveal and grouping by the host
  await page.getByRole("button", { name: /^Next: Retro: group/ }).click();
  await expect(ana.getByText("Too many manual steps to release")).toBeVisible();
  const host_ = page.locator(".retro-host");
  await host_.getByRole("button", { name: "Deploys are slow" }).click();
  await host_.getByRole("button", { name: "Too many manual steps to release" }).click();
  await host_.getByLabel("Group name").first().fill("Release pain");
  await host_.getByLabel("Group name").first().blur();
  await shot(page, "2-group-control");

  // Vote: three votes each, one used here
  await page.getByRole("button", { name: /^Next: Retro: vote/ }).click();
  for (const p of [ana, ben]) {
    await p.getByRole("listitem").filter({ hasText: "Release pain" }).getByRole("button", { name: "Vote" }).click();
    await expect(p.getByText("2 votes left out of 3")).toBeVisible();
  }
  await expect(page.getByText("2 of 2 people have voted")).toBeVisible();
  await shot(ben, "3-vote");

  // Discussion of the most voted group, with a decision noted by the host
  await page.getByRole("button", { name: /^Next: Discuss: Release pain/ }).click();
  await expect(ana.locator(".retro-focus").getByRole("heading", { name: "Release pain" })).toBeVisible();
  await shot(ana, "4-discuss");
  await page.getByRole("textbox", { name: "Notes · Host" }).fill("Decision: one release train per week");
  // Notes are saved a moment after typing stops
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /End the meeting/ }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();
  await page.getByRole("button", { name: "Archive the meeting" }).click();
  await page.getByRole("button", { name: "Yes, archive" }).click();
  await expect(page.getByText("Meeting archived with its minutes.")).toBeVisible();

  // Minutes: the groups and the decision, nobody's name in the retro
  await page.goto(`${meeting}/history`);
  const retro = page.locator(".minutes-sec").filter({ has: page.getByRole("heading", { name: "Retrospective" }) });
  await expect(retro.getByText("Release pain")).toBeVisible();
  await expect(retro.getByText("Too many manual steps to release")).toBeVisible();
  await expect(retro.getByText(/Ana|Ben/)).toHaveCount(0);
  await expect(page.locator(".minutes-sec").filter({ hasText: "Decisions" }).getByText("one release train per week")).toBeVisible();
  for (const p of [ana, ben]) await p.context().close();
});
