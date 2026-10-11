import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { DOCS, ffmpeg, meetingOf, RAW, SITE, signedIn } from "./film";

// The pictures of the README and of the website, taken on the demo workspace (pnpm db:seed --force): the main
// pages in light and dark, taken at twice the pixel density, then written as WebP to docs/media (README, 1440
// wide) and, when a website asks for them (SITE_MEDIA_DIR), to its folder (1920 wide, sharp on high-density screens).
//   pnpm --filter @ronde/web media

const SIZE = { width: 1440, height: 900 };

/** One screenshot, two pictures: the README's and the site's */
async function shot(page: Page, name: string, { readme = true, site = true } = {}) {
  await page.waitForTimeout(900);
  const png = path.join(RAW, `${name}.png`);
  await page.screenshot({ path: png });
  const width = page.viewportSize()!.width;
  const write = (dir: string, w: number) =>
    ffmpeg("-i", png, "-vf", `scale=${w}:-2:flags=lanczos`, "-c:v", "libwebp", "-quality", "84", path.join(dir, `${name}.webp`));
  if (readme) write(DOCS, width);
  if (site && SITE) write(SITE, Math.min(1920, width * 2));
}

async function controlRoom(page: Page, meeting: string) {
  await page.goto(`${meeting}/control`);
  await expect(page.locator("main")).toBeVisible();
  await page
    .getByRole("button", { name: "Skip the tour" })
    .click({ timeout: 3000 })
    .catch(() => {});
}

test("pictures of the README and the site", async ({ browser }) => {
  test.setTimeout(300_000);
  for (const dir of [RAW, DOCS, SITE]) if (dir) mkdirSync(dir, { recursive: true });
  const desktop = { viewport: SIZE, deviceScaleFactor: 2 };

  // Light: the workspace, the portfolio, a project, the minutes, then a session running
  const { context, page } = await signedIn(browser, { ...desktop, colorScheme: "light" });
  const meeting = await meetingOf(page);
  await page.goto("/w/demo");
  await shot(page, "home");
  await page.goto("/w/demo/projects");
  await shot(page, "portfolio");
  await page.goto("/w/demo/projects/billing-api");
  await shot(page, "project", { site: false });
  await page.goto(`${meeting}/history`);
  await shot(page, "minutes");

  await controlRoom(page, meeting);
  await page.getByRole("button", { name: "Start the meeting" }).click();
  const screen = await context.newPage();
  await screen.goto(`${meeting}/screen`);
  await shot(screen, "screen-intro", { site: false });
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: /^Next: / }).click();
    await screen.waitForTimeout(400);
  }
  await screen.waitForTimeout(3000);
  await shot(screen, "screen-turn");
  await shot(page, "control");
  // A spin of the wheel, in front of the shared screen while it plays
  await page.getByRole("tab", { name: "Random" }).click();
  await page.getByRole("button", { name: "Spin", exact: true }).click();
  await screen.waitForTimeout(1600);
  await shot(screen, "screen-wheel", { site: false });
  await context.close();

  // Dark: the same session, as the shared screen and the control room show it at night
  const dark = await signedIn(browser, { ...desktop, colorScheme: "dark" });
  await controlRoom(dark.page, meeting);
  await shot(dark.page, "control-dark");
  const darkScreen = await dark.context.newPage();
  await darkScreen.goto(`${meeting}/screen`);
  await shot(darkScreen, "screen-dark");
  await dark.page.goto("/w/demo/projects");
  await shot(dark.page, "portfolio-dark");
  await dark.page.goto("/w/demo");
  await shot(dark.page, "home-dark", { readme: false });
  await dark.page.goto(`${meeting}/history`);
  await shot(dark.page, "minutes-dark", { readme: false });
  await dark.context.close();

  // On a phone: a participant's view, in both themes
  for (const colorScheme of ["light", "dark"] as const) {
    const phone = await signedIn(browser, {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme,
    });
    await phone.page.goto(`${meeting}/me`);
    await phone.page.waitForTimeout(1200);
    await shot(phone.page, colorScheme === "dark" ? "phone-dark" : "phone", { readme: colorScheme === "light" });
    await phone.context.close();
  }
});
