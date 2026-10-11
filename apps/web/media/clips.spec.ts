import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { DOCS, encodeClip, film, HUGO, loopWebp, meetingOf, signedIn } from "./film";

// The clips of the README and of the website, on a fresh demo workspace (pnpm db:seed --force): Hugo fills in
// his check-in on his phone, then a session runs on the shared screen from start to minutes. Each clip is
// filmed frame by frame (film.ts); the README gets a loop of the round table, a website asking for them
// (SITE_MEDIA_DIR) its tour's clips as H.264 with a poster, and the frames stay in media/.work for its promo video.

// Filmed at their real size: larger frames are slower to paint and encode, and the clips would stutter
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

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

test("clips of the site and the promo video", async ({ browser }) => {
  test.setTimeout(600_000);
  const host = await signedIn(browser, DESKTOP);
  const meeting = await meetingOf(host.page);

  // Hugo is in the directory without an account: the host invites him, he signs up from his phone
  await host.page.goto("/w/demo/people");
  await host.page.getByRole("button", { name: "Actions for Hugo Moreau" }).click();
  await host.page.getByRole("button", { name: "Send an invitation" }).click();
  await host.page.getByRole("dialog", { name: "Invite someone" }).getByRole("button", { name: "Send the invitation" }).click();
  const invite = await host.page.getByRole("dialog", { name: "Invitation link" }).getByRole("textbox").inputValue();
  const phoneContext = await browser.newContext({ locale: "en-US", ...PHONE });
  const phone = await phoneContext.newPage();
  await phone.goto(invite);
  await phone.getByRole("link", { name: "Create an account" }).click();
  await phone.getByLabel("Full name").fill(HUGO.name);
  await phone.getByLabel("Password", { exact: true }).fill(HUGO.password);
  await phone.getByRole("button", { name: "Create account" }).click();
  await phone.getByRole("button", { name: /^Join / }).click();
  await phone.waitForURL(/\/w\/demo$/);

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
    await glide(phone, "role=button[name='Save my check-in']");
    await phone.getByRole("button", { name: "Save my check-in" }).click();
    await phone.waitForTimeout(1500);
  });
  encodeClip(checkin, "checkin", { width: 780 });

  // During: the session starts on the shared screen and goes round the table
  await host.page.goto(`${meeting}/control`);
  await host.page
    .getByRole("button", { name: "Skip the tour" })
    .click({ timeout: 3000 })
    .catch(() => {});
  const screen = await host.context.newPage();
  await screen.goto(`${meeting}/screen`);
  await screen.waitForTimeout(2500);
  const round = await film(screen, "round", async () => {
    await screen.waitForTimeout(2000);
    await host.page.getByRole("button", { name: "Start the meeting" }).click();
    await screen.waitForTimeout(9000);
    for (let i = 0; i < 3; i++) {
      await host.page.getByRole("button", { name: /^Next: / }).click();
      await screen.waitForTimeout(4500);
    }
  });
  // The site loops the round table itself, from the first hand-over on
  encodeClip(round, "round", { width: 1440, from: 10.5 });
  // The README's loop: the round table going from one person to the next
  loopWebp(round, path.join(DOCS, "session"), { width: 960, from: 11 });

  // The host, in the control room: next turn, a decision for the minutes
  const control = await film(host.page, "control", async () => {
    await host.page.waitForTimeout(1000);
    await host.page.getByRole("button", { name: /^Next: / }).click();
    await host.page.waitForTimeout(1200);
    await host.page.getByRole("button", { name: "+ Decision" }).click();
    await write(host.page, "The new spacing scale ships with the next release");
    await host.page.waitForTimeout(1800);
  });
  encodeClip(control, "control", { width: 1440 });

  // Reactions from Hugo's phone, on the shared screen
  await phone.getByRole("tab", { name: /Live meeting|Meeting/ }).click();
  await phone.waitForTimeout(800);
  // On a phone the reactions wait behind their button
  await phone.getByRole("button", { name: "Reactions" }).click();
  const reactions = await film(screen, "reactions", async () => {
    await screen.waitForTimeout(600);
    for (const emoji of ["👏", "🎉", "👍", "👏"]) {
      await phone.getByRole("button", { name: `React ${emoji}` }).click();
      await screen.waitForTimeout(450);
    }
    await phone.getByRole("button", { name: "Raise my hand" }).click();
    await screen.waitForTimeout(2600);
  });
  encodeClip(reactions, "reactions", { width: 1440 });

  // A spin of the wheel, in front of everyone (for the promo video only)
  await host.page.getByRole("tab", { name: "Random" }).click();
  await film(screen, "wheel", async () => {
    await screen.waitForTimeout(500);
    await host.page.getByRole("button", { name: "Spin", exact: true }).click();
    await screen.waitForTimeout(6500);
  });

  // After: the recap on the shared screen (for the promo video), then the minutes
  await film(screen, "recap", async () => {
    await screen.waitForTimeout(500);
    await host.page.getByRole("button", { name: /End the meeting/ }).click();
    await host.page.getByRole("button", { name: "Yes, end it" }).click();
    await screen.waitForTimeout(7000);
  });
  await host.page
    .getByRole("textbox", { name: "Summary" })
    .fill("A good week: the help center outline is approved and the spacing scale ships.");
  await host.page.getByRole("button", { name: "Archive the meeting" }).click();
  await host.page.getByRole("button", { name: "Yes, archive" }).click();
  await expect(host.page.getByText(/Meeting archived with its minutes/)).toBeVisible();
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

  await phoneContext.close();
  await host.context.close();
});
