import { expect, type Page, test } from "@playwright/test";
import { createMeeting, hostWithWorkspace, invite, joinWithNewAccount } from "./helpers";

// My screen: its tabs carry a pictogram each and stand apart from the content; the sound and animations
// popover (portalled out of the tab row) keeps the row's pills and an accent-coloured volume slider

const run = Date.now().toString(36);
/** Screenshots for a visual review, only when SHOTS names a folder */
const shot = async (p: Page, name: string) => {
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/my-screen-${name}.png` });
};

test("my screen's tabs and its sound and animations settings", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const workspace = await hostWithWorkspace(
    page,
    { name: "Tia Tabs", email: `tia-${run}@example.com`, password: "tabs-password-123" },
    `Tabs ${run}`,
  );
  const link = await invite(page, workspace, `max-${run}@example.com`, "Max", "Mind");
  const meeting = await createMeeting(page, workspace, "Weekly sync");
  const max = await joinWithNewAccount(browser, link, { name: "Max Mind", email: `max-${run}@example.com`, password: "max-password-1234" });
  await max.goto(`${meeting}/me`);

  const tabs = max.getByRole("tablist", { name: "My screen" }).getByRole("tab");
  await expect(tabs.first()).toBeVisible();
  for (const tab of await tabs.all()) await expect(tab.locator("svg, .tab-live")).toHaveCount(1);
  // The breadcrumb opens on the workspace: its mark, its name in the display face
  const ws = max.getByRole("navigation", { name: "Location" }).getByRole("link").first();
  await expect(ws.locator(".crumb-mark")).toHaveCount(1);
  await expect(ws.locator(".crumb-ws")).toHaveText(`Tabs ${run}`);
  // The row is set apart from the content by a rule
  await expect(max.locator(".me-tabs")).toHaveCSS("border-bottom-style", "solid");

  await max.getByRole("button", { name: "Sound and animations" }).click();
  const pop = max.locator(".my-prefs-pop");
  const sounds = pop.locator(".my-sound > button").first();
  await expect(sounds).toHaveCSS("border-radius", "999px");
  await expect(pop.locator(".my-motion > button")).toHaveCSS("border-radius", "999px");
  // The browser's own grey buttons would have a background of their own; the pills take the surface's
  await expect(sounds).not.toHaveCSS("background-color", "rgb(239, 239, 239)");
  if (await pop.locator('input[type="range"]').count())
    await expect(pop.locator('input[type="range"]')).not.toHaveCSS("accent-color", "auto");
  await shot(max, "light");
  await max.emulateMedia({ colorScheme: "dark" });
  await shot(max, "dark");
});
