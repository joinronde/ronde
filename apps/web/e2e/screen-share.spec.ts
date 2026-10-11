import { chromium, expect, type Page, test } from "@playwright/test";

// Screen sharing to the room: the control room sends the host's screen straight to the shared screen tab
// (WebRTC between the two tabs, signalled through the meeting's event stream). Chromium fakes the capture.

const run = Date.now().toString(36);
const host = { name: "Hugo Host", email: `hugo-share-${run}@example.com`, password: "host-password-123" };

async function signUp(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(host.name);
  await page.getByLabel("Email", { exact: true }).fill(host.email);
  await page.getByLabel("Password", { exact: true }).fill(host.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

test("the host's screen shows on the room screen, and leaves it when the share stops", async ({ baseURL }) => {
  test.setTimeout(180_000);
  // A browser that grants screen capture by itself, with a generated picture
  const browser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-select-desktop-capture-source=Entire screen"],
  });
  const context = await browser.newContext({ baseURL, locale: "en-US" });
  const page = await context.newPage();
  await signUp(page);
  await page.getByLabel("Workspace name").fill(`Share ${run}`);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  await page.waitForURL(/\/w\/share-/);
  await page.goto(`${page.url()}/meetings/new`);
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByLabel("Name").fill("Room meeting");
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Create the meeting" }).click();
  await page.waitForURL(/\/m\/[^/]+\/control$/, { timeout: 120_000 });
  const meeting = page.url().replace(/\/control$/, "");
  await page.getByRole("button", { name: "Skip the tour" }).click();

  // The room screen is open in another tab
  const screen = await context.newPage();
  await screen.goto(`${meeting}/screen`);
  await expect(screen.locator(".share-view")).not.toHaveClass(/on/);

  await page.getByRole("button", { name: /Share my screen/ }).click();
  await expect(screen.locator(".share-view")).toHaveClass(/on/, { timeout: 30_000 });
  // Pictures arrive: the video has a size
  await expect
    .poll(() => screen.locator(".share-view video").evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect(page.locator(".share-count")).toHaveText("1");
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/share-control.png` });
    await screen.screenshot({ path: `${process.env.SHOTS}/share-screen.png` });
  }

  await page.getByRole("button", { name: /Stop sharing/ }).click();
  await expect(screen.locator(".share-view")).not.toHaveClass(/on/, { timeout: 15_000 });
  await browser.close();
});
