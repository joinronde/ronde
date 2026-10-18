import { expect, test } from "@playwright/test";
import { createMeeting, hostWithWorkspace } from "./helpers";

// A setting changes on screen as it is clicked, not once the server has answered: the server is slowed down
// here, and the controls must already show the new value

const run = Date.now().toString(36);

test("settings show their new value at once, while the server is still answering", async ({ page }) => {
  test.setTimeout(180_000);
  const workspace = await hostWithWorkspace(
    page,
    { name: "Ida Instant", email: `ida-${run}@example.com`, password: "instant-password-123" },
    `Instant ${run}`,
  );
  const meeting = await createMeeting(page, workspace, "Weekly sync");

  // Every operation takes 2.5 s to come back
  await page.route("**/rpc", async (route) => {
    await new Promise((done) => setTimeout(done, 2500));
    await route.continue();
  });

  await page.goto(`${meeting}/settings#modules`);
  const polls = page.getByRole("switch", { name: "Use Polls in this meeting" });
  const before = await polls.getAttribute("aria-checked");
  await polls.click();
  await expect(polls).not.toHaveAttribute("aria-checked", before ?? "", { timeout: 400 });

  await page.goto(`${meeting}/settings#projects`);
  const everyone = page.getByRole("radio", { name: /Every participant/ });
  await everyone.check({ force: true });
  await expect(everyone).toBeChecked({ timeout: 400 });
  await expect(page.locator(".choice-card.on")).toContainText("Every participant", { timeout: 400 });
});
