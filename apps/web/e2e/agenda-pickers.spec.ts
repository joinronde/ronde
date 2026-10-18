import { expect, type Page, test } from "@playwright/test";
import { createMeeting, hostWithWorkspace } from "./helpers";

// The agenda's pickers: the blocks to add as a grid of tiles that fits on screen (it was cut by the top bar
// when it opened upwards), and the retrospective's column sets drawn as small boards

const run = Date.now().toString(36);
/** Screenshots for a visual review, only when SHOTS names a folder */
const shot = async (p: Page, name: string) => {
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/pickers-${name}.png` });
};

test("the blocks to add and the retrospective's columns are pictures, in full view", async ({ page }) => {
  test.setTimeout(180_000);
  const workspace = await hostWithWorkspace(
    page,
    { name: "Pia Pickers", email: `pia-${run}@example.com`, password: "pickers-password-123" },
    `Pickers ${run}`,
  );
  const meeting = await createMeeting(page, workspace, "Team retro");
  await page.goto(`${meeting}/settings#modules`);
  await page.getByRole("switch", { name: "Use Retrospective in this meeting" }).click();
  await expect(page.getByText("Retrospective turned on")).toBeVisible();

  await page.goto(`${meeting}/settings#agenda`);
  await page.getByRole("button", { name: "Add a block" }).click();
  const pop = page.locator(".agenda-add .menu-pop");
  await expect(pop).toBeVisible();
  // Every tile in view, under the top bar, none cut
  const bar = (await page.locator(".topbar").boundingBox())!;
  const box = (await pop.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await expect(pop.getByRole("button", { name: /^Intro/ })).toBeInViewport();
  await expect(pop.getByRole("button", { name: /^Planning poker/ })).toBeInViewport();
  await shot(page, "add");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Change the columns, votes and times" }).click();
  const sets = page.getByRole("group", { name: "Columns" });
  await expect(sets.getByRole("radio")).toHaveCount(5);
  await sets.getByText("Mad, sad, glad").click();
  await expect(sets.getByRole("radio", { name: "Mad, sad, glad" })).toBeChecked();
  await expect(page.locator(".preset-card.on .preset-col")).toHaveText(["Mad", "Sad", "Glad"]);
  await page.locator(".retro-presets").scrollIntoViewIfNeeded();
  await shot(page, "retro");
});
