import { writeFileSync } from "node:fs";
import path from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { DOCS, encodeClip, film, HUGO, loopWebp, meetingOf, RAW, signedIn } from "./film";

// The clips of the README and of the website, on a fresh demo workspace (pnpm db:seed --force): Hugo fills in
// his check-in on his phone, then a session runs on the shared screen from start to minutes. Each clip is
// filmed frame by frame (film.ts); the README gets a loop of the round table, a website asking for them
// (SITE_MEDIA_DIR) its tour's clips as H.264 with a poster, and the frames stay in media/.work for its promo video.

// Filmed at their real size: larger frames are slower to paint and encode, and the clips would stutter
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
/** Two more people of the demo who answer the poll from their own screens (not filmed) */
const VOTERS = [
  { name: "Lucas Martin", password: "lucas-demo-password" },
  { name: "Sofia Rossi", password: "sofia-demo-password" },
];

/** Scrolls an element to the middle of the screen, smoothly, as a person would */
async function glide(page: Page, selector: Parameters<Page["locator"]>[0]) {
  await page
    .locator(selector)
    .first()
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  await page.waitForTimeout(700);
}

/** Types like a person, a little faster */
async function write(page: Page, text: string) {
  await page.keyboard.type(text, { delay: 38 });
}

/** The host invites a person of the directory; returns the invitation link */
async function inviteFromDirectory(host: Page, name: string) {
  await host.goto("/w/demo/people");
  await host.getByRole("button", { name: `Actions for ${name}` }).click();
  await host.getByRole("button", { name: "Send an invitation" }).click();
  await host.getByRole("dialog", { name: "Invite someone" }).getByRole("button", { name: "Send the invitation" }).click();
  const link = await host.getByRole("dialog", { name: "Invitation link" }).getByRole("textbox").inputValue();
  await host.getByRole("button", { name: "Close" }).click();
  return link;
}

/** A person signs up from their invitation, in a browser of their own */
async function joins(browser: Browser, link: string, who: { name: string; password: string }, options: object) {
  const context = await browser.newContext({ locale: "en-US", ...options });
  const page = await context.newPage();
  await page.goto(link);
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Full name").fill(who.name);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: /^Join / }).click();
  await page.waitForURL(/\/w\/demo$/);
  return { context, page };
}

test("clips of the site and the promo video", async ({ browser }) => {
  test.setTimeout(600_000);
  const host = await signedIn(browser, DESKTOP);
  const meeting = await meetingOf(host.page);

  // Hugo is in the directory without an account: the host invites him, he signs up from his phone
  const { context: phoneContext, page: phone } = await joins(browser, await inviteFromDirectory(host.page, HUGO.name), HUGO, PHONE);
  const voters: Awaited<ReturnType<typeof joins>>[] = [];
  for (const who of VOTERS) voters.push(await joins(browser, await inviteFromDirectory(host.page, who.name), who, DESKTOP));

  // Before: Hugo's check-in, on his phone
  await phone.goto(`${meeting}/me`);
  await phone.waitForTimeout(2500);
  const checkin = await film(phone, "checkin", async () => {
    await phone.waitForTimeout(700);
    await phone.getByRole("textbox", { name: "Done this week" }).click();
    await write(phone, "Help center outline approved");
    await phone.keyboard.press("Enter");
    await write(phone, "First 12 articles written");
    await phone.waitForTimeout(300);
    await glide(phone, "role=textbox[name='Planned for next week']");
    await phone.getByRole("textbox", { name: "Planned for next week" }).click();
    await write(phone, "Search that forgives typos");
    await phone.waitForTimeout(300);
    await glide(phone, "role=group[name='My mood']");
    await phone.getByRole("button", { name: "Sunny" }).click();
    await phone.waitForTimeout(800);
    // No button: the check-in saves itself a moment after the last change, and says so
    await glide(phone, ".checkin-status");
    await expect(phone.locator(".checkin-status")).toContainText("Saved");
    await phone.waitForTimeout(1500);
  });
  encodeClip(checkin, "checkin", { width: 780 });

  // The session starts; the shared screen shows the intro, then the irritants raised before the meeting
  await host.page.goto(`${meeting}/control`);
  await host.page
    .getByRole("button", { name: "Skip the tour" })
    .click({ timeout: 3000 })
    .catch(() => {});
  const screen = await host.context.newPage();
  await screen.goto(`${meeting}/screen`);
  await screen.waitForTimeout(2500);
  await host.page.getByRole("button", { name: "Start the meeting" }).click();
  await screen.waitForTimeout(6000);
  await film(screen, "irritants", async () => {
    await host.page.getByRole("button", { name: /^Next: Irritants/ }).click();
    await screen.waitForTimeout(2800);
    // The host turns the first one into an action: it says so on the shared screen
    await host.page.getByRole("button", { name: "Make it an action" }).first().click();
    await screen.waitForTimeout(3200);
  });

  // During: the round table, one person after the other
  const round = await film(screen, "round", async () => {
    await screen.waitForTimeout(400);
    for (let i = 0; i < 3; i++) {
      await host.page.getByRole("button", { name: /^Next: / }).click();
      await screen.waitForTimeout(4500);
    }
  });
  encodeClip(round, "round", { width: 1440 });
  // The README's loop: the round table going from one person to the next
  loopWebp(round, path.join(DOCS, "session"), { width: 960, from: 0.5 });

  // The host, in the control room: next turn, a decision for the minutes
  const control = await film(host.page, "control", async () => {
    await host.page.waitForTimeout(1000);
    await host.page.getByRole("button", { name: /^Next: / }).click();
    await host.page.waitForTimeout(1200);
    await host.page.getByRole("button", { name: "Decision", exact: true }).click();
    // The editor takes the focus a moment after the button: typed earlier, the first letter would be lost
    await host.page.waitForTimeout(400);
    await write(host.page, "The new spacing scale ships with the next release");
    await host.page.waitForTimeout(1800);
  });
  encodeClip(control, "control", { width: 1440 });

  // Everyone else follows on their own screen: Hugo reacts and raises his hand from his phone, then the team
  // answers a poll (yes, no, yes) — his phone and the shared screen filmed at the same time
  for (const v of voters) {
    await v.page.goto(`${meeting}/me`);
    await v.page.getByRole("tab", { name: /Live meeting|Meeting/ }).click();
  }
  await phone.getByRole("tab", { name: /Live meeting|Meeting/ }).click();
  await phone.waitForTimeout(800);
  let together = "";
  let lead = 0;
  await film(phone, "live-phone", async () => {
    const phoneFrom = Date.now();
    together = await film(screen, "live-screen", async () => {
      lead = (Date.now() - phoneFrom) / 1000;
      await screen.waitForTimeout(600);
      // On a phone the reactions wait behind their button; each is named for what it says
      await phone.getByRole("button", { name: "Reactions", exact: true }).click();
      for (const name of ["Well done", "Let's celebrate", "I agree"]) {
        await phone.getByRole("button", { name, exact: true }).click();
        await screen.waitForTimeout(450);
      }
      await phone.getByRole("button", { name: "Raise my hand" }).click();
      await screen.waitForTimeout(1800);
      // The host asks, and shows the poll on the shared screen
      await host.page.getByRole("tab", { name: /^Polls/ }).click();
      await host.page.getByLabel("Question").fill("Do we ship the help center on Friday?");
      await host.page.getByRole("textbox", { name: "Choice 1" }).fill("Yes");
      await host.page.getByRole("textbox", { name: "Choice 2" }).fill("No");
      await host.page.locator(".poll-new").getByRole("checkbox", { name: "Anonymous" }).uncheck();
      await host.page.getByRole("button", { name: "Ask the team" }).click();
      await host.page.getByRole("button", { name: "Show on the shared screen" }).click();
      await screen.waitForTimeout(1200);
      await glide(phone, ".poll-card");
      await phone.getByRole("radio", { name: "Yes" }).check();
      await phone.locator(".poll-card").getByRole("button", { name: "Answer" }).click();
      await screen.waitForTimeout(1500);
      for (const [v, answer] of [
        [voters[0]!, "No"],
        [voters[1]!, "Yes"],
      ] as const) {
        await v.page.getByRole("radio", { name: answer }).check();
        await v.page.locator(".poll-card").getByRole("button", { name: "Answer" }).click();
        await screen.waitForTimeout(1500);
      }
      await screen.waitForTimeout(1500);
    });
  });
  // How long the phone was filmed before the shared screen: the promo lines the two up
  writeFileSync(path.join(RAW, "live-lead.json"), JSON.stringify({ lead }));
  // The site's tour keeps its reactions clip: the first seconds of the shared screen above
  encodeClip(together, "reactions", { width: 1440, to: 4.5 });

  // After: the recap on the shared screen, then the host sums the session up and publishes the minutes
  await film(screen, "recap", async () => {
    await screen.waitForTimeout(500);
    await host.page.getByRole("button", { name: /End the meeting/ }).click();
    await host.page.getByRole("button", { name: "Yes, end it" }).click();
    await screen.waitForTimeout(7000);
  });
  await host.page.getByRole("button", { name: "Review and publish the minutes" }).click();
  await host.page.waitForTimeout(1200);
  await film(host.page, "studio", async () => {
    await host.page.waitForTimeout(600);
    await host.page.getByRole("textbox", { name: "Summary" }).click();
    await write(host.page, "A good week: the help center outline is approved and the spacing scale ships.");
    await host.page.waitForTimeout(1500);
    await host.page.getByRole("button", { name: "Publish the minutes", exact: true }).click();
    await host.page.getByRole("button", { name: "Yes, publish" }).click();
    await expect(host.page.getByText(/Minutes published, session closed/)).toBeVisible();
    await host.page.waitForTimeout(1500);
  });
  await host.page.goto(`${meeting}/history`);
  await host.page.waitForTimeout(1500);
  const minutes = await film(host.page, "minutes", async () => {
    await host.page.waitForTimeout(800);
    // A slow, steady scroll through the minutes
    await host.page.evaluate(async () => {
      const box = document.scrollingElement!;
      const from = box.scrollTop;
      const to = Math.min(from + 1400, box.scrollHeight - innerHeight);
      const start = performance.now();
      await new Promise<void>((done) => {
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / 6000);
          box.scrollTop = from + (to - from) * (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
          if (t < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
    });
    await host.page.waitForTimeout(800);
  });
  encodeClip(minutes, "minutes", { width: 1440 });

  for (const v of voters) await v.context.close();
  await phoneContext.close();
  await host.context.close();
});
