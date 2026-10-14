import { expect, type Page, test } from "@playwright/test";
import { choose } from "./select";

// Visual tour of the main pages, for design reviews: only with SHOTS=<folder>, on the seeded demo workspace

test.skip(!process.env.SHOTS, "visual tour: SHOTS=<folder> and the demo seed");

const shot = (p: Page, name: string) => p.screenshot({ path: `${process.env.SHOTS}/tour-${name}.png`, fullPage: true });

test("tour of the main pages", async ({ page }) => {
  // A long tour: every page, light and dark, phone and desktop
  test.setTimeout(420_000);
  await page.goto("/sign-in");
  await page.screenshot({ path: `${process.env.SHOTS}/tour-0a-sign-in.png` });
  const width = async () => (await page.locator(".auth-body").boundingBox())?.width;
  const before = await width();
  await page.getByText("With email link").click();
  expect(await width()).toBe(before);
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${process.env.SHOTS}/tour-0b-sign-in-link.png` });
  await page.getByRole("button", { name: "Language" }).click();
  await page.screenshot({ path: `${process.env.SHOTS}/tour-0c-language.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.screenshot({ path: `${process.env.SHOTS}/tour-0d-dark.png` });
  await page.getByRole("radio", { name: "System" }).click();
  await page.getByText("With password").click();
  await page.getByLabel("Email", { exact: true }).fill("host@example.com");
  await page.getByLabel("Password", { exact: true }).fill("ronde-demo-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/w\/demo/);
  await page.goto("/w/demo");
  await page.waitForTimeout(1200);
  await shot(page, "1-workspace");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await shot(page, "1-workspace-mobile");
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(500);
  await shot(page, "1-workspace-tablet");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/w/demo/people");
  await shot(page, "2-people");
  await page.getByRole("button", { name: /Notifications/ }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${process.env.SHOTS}/tour-1h-bell.png` });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search the workspace" }).fill("sta");
  await page
    .getByRole("option", { name: /staging/ })
    .first()
    .waitFor({ timeout: 10_000 });
  await page.screenshot({ path: `${process.env.SHOTS}/tour-1f-search.png` });
  await page.keyboard.press("Escape");
  await page.goto("/w/demo/people");
  await page.getByRole("link", { name: "Emma Laurent" }).click();
  await page.getByRole("heading", { level: 1, name: /Emma Laurent/ }).waitFor();
  await page.waitForTimeout(1100);
  await shot(page, "1g-profile");
  await page.goto("/w/demo/actions");
  await page.getByRole("heading", { name: "Actions", level: 1 }).waitFor();
  await shot(page, "1b-actions");
  await page.getByRole("button", { name: /Mark “Book a room/ }).click();
  await page.waitForTimeout(600);
  await shot(page, "1c-actions-ticked");
  await page.getByRole("button", { name: /Reopen “Book a room/ }).click();
  await page.getByRole("button", { name: /Mark “Book a room/ }).waitFor();
  await page.goto("/w/demo/actions?view=hosted");
  await shot(page, "1d-actions-hosted");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await shot(page, "1e-actions-mobile");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/w/demo/meetings");
  await page.waitForTimeout(700);
  await shot(page, "1i-meetings");
  await page.goto("/w/demo/templates");
  await page.waitForTimeout(900);
  await shot(page, "1k-templates");
  await page.getByRole("button", { name: /^Education/ }).click();
  await page.waitForTimeout(600);
  await shot(page, "1l-templates-education");
  await page.goto("/w/demo/kudos");
  await page.waitForTimeout(1200);
  await shot(page, "1m-kudos");
  await page.goto("/w/demo/decisions");
  await page.waitForTimeout(700);
  await shot(page, "1j-decisions");
  await page.goto("/w/demo/calendar");
  await shot(page, "2a-calendar");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await shot(page, "2a-calendar-mobile");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/w/demo/insights?weeks=26");
  await page.getByRole("heading", { name: "Insights", level: 1 }).waitFor();
  await shot(page, "2b-insights");
  await page.goto("/w/demo/settings");
  await shot(page, "3-ws-settings");
  await page.getByRole("main").getByRole("combobox").first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${process.env.SHOTS}/tour-3-select-open.png` });
  await page.keyboard.press("Escape");
  // A change, so the audit log has something to show (Enterprise license only)
  await page.goto("/w/demo/settings");
  await page.getByLabel("Name", { exact: true }).fill(`Demo ${Date.now().toString(36)}`);
  // Saved by itself a moment later
  await expect(page.getByText("✓ Saved").first()).toBeVisible();
  await page.goto("/w/demo/settings/audit").catch(() => {});
  await shot(page, "3b-audit");
  await page.goto("/w/demo/settings/roles");
  if (await page.getByRole("button", { name: "+ New role" }).isVisible()) {
    await page.getByRole("button", { name: "+ New role" }).click();
    await page.getByLabel("Name", { exact: true }).fill(`Auditor ${Date.now().toString(36)}`);
    await page.getByLabel("Read the history").check();
    await page.getByLabel("See the statistics").check();
    await shot(page, "3c-role-form");
    await page.getByRole("button", { name: "Save the role" }).click();
    await page.waitForTimeout(600);
  }
  await shot(page, "3d-roles");
  await page.goto("/w/demo/settings/security");
  if (await page.getByLabel("Email domain").isVisible()) {
    await page.getByLabel("Email domain").fill(`acme-${Date.now().toString(36)}.com`);
    await page.getByRole("button", { name: "Add the domain" }).click();
    await page.waitForTimeout(600);
  }
  await shot(page, "3f-security");
  await page.goto("/w/demo/people");
  await shot(page, "3e-people");
  await page.goto("/account");
  await shot(page, "4-account");
  await page.goto("/admin");
  await shot(page, "5-admin");
  await page.goto("/w/demo");
  await page.locator("a[href*='/m/']").first().click();
  await page.waitForURL(/\/m\//);
  const meeting = page.url().replace(/\/(control|me)$/, "");
  await page.goto(`${meeting}/control`);
  await expect(page.locator("main")).toBeVisible();
  await page
    .getByRole("button", { name: "Skip the tour" })
    .click({ timeout: 3000 })
    .catch(() => {});
  await shot(page, "6-control");
  await page.goto(`${meeting}/me`);
  await shot(page, "7-me");
  await page.goto(`${meeting}/history`);
  await shot(page, "8-history");
  await page.goto(`${meeting}/settings`);
  await shot(page, "9-meeting-settings");
  // The workspace's own logo (Team): drawn here, uploaded, then shown in the sidebar and on the shared screen
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 360;
    c.height = 120;
    const g = c.getContext("2d")!;
    g.fillStyle = "#1d6fd8";
    g.beginPath();
    g.arc(60, 60, 46, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "bold 44px sans-serif";
    g.fillText("A", 45, 76);
    g.fillStyle = "#1d6fd8";
    g.font = "bold 54px sans-serif";
    g.fillText("Acme", 125, 80);
    return c.toDataURL("image/png").split(",")[1]!;
  });
  await page.goto("/w/demo/settings");
  // The handler of the file field exists once the page is hydrated
  await page.waitForLoadState("networkidle");
  await page
    .locator(".logo-settings input[type=file]")
    .setInputFiles({ name: "acme.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.locator(".logo-preview img").first().waitFor();
  await page.waitForTimeout(500);
  await shot(page, "9b-logo-settings");
  const screen = await page.context().newPage();
  await screen.setViewportSize({ width: 1280, height: 720 });
  await screen.goto(`${meeting}/screen`);
  await screen.waitForTimeout(1500);
  await screen.screenshot({ path: `${process.env.SHOTS}/tour-9c-screen-logo.png` });
  await screen.close();
  await page.locator(".logo-settings").getByRole("button", { name: "Remove" }).click();
  await page.locator(".logo-empty").waitFor();
  // The AI assistant, set up with a key (no call is made here)
  const aiCard = page.locator(".ai-settings");
  await aiCard.getByLabel("Turn on the AI assistant").check();
  await aiCard.getByLabel("Anthropic API key").fill("sk-ant-demo-0000");
  await aiCard.getByRole("button", { name: "Save" }).click();
  await aiCard.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  await aiCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${process.env.SHOTS}/tour-9d-ai-settings.png` });
  // An issue tracker, then the actions page offers tickets (nothing is sent here)
  const trackersCard = page.locator(".trackers");
  await trackersCard.getByRole("button", { name: "Add an issue tracker" }).click();
  // Jira keeps its own token (GitLab and GitHub trackers go through a connection, checked with the forge)
  await choose(page, trackersCard.getByLabel("Tool"), "jira");
  await trackersCard.getByLabel("Site address").fill("https://acme.atlassian.net");
  await trackersCard.getByLabel("Project key").fill("OPS");
  await trackersCard.getByLabel("Email of the account").fill("bot@acme.com");
  await trackersCard.getByLabel("API token").fill("jira-demo-token");
  await trackersCard.getByRole("button", { name: "Save" }).click();
  await trackersCard.locator(".tracker-list li").first().waitFor();
  await trackersCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${process.env.SHOTS}/tour-9f-trackers.png` });
  await page.goto("/w/demo/actions?view=hosted");
  await page.getByRole("heading", { name: "Actions", level: 1 }).waitFor();
  await shot(page, "9g-actions-tickets");
  // A workflow: a webhook connector, the suggested rules, then conditions and words of the team on one of them
  await page.goto("/w/demo/settings");
  const connectorsCard = page.locator("#connectors");
  await choose(page, connectorsCard.getByLabel("Add a connector"), "webhook");
  await connectorsCard.getByLabel("Name").fill("Team hook");
  await connectorsCard.getByLabel("Receiving address (https)").fill("https://hooks.example.org/ronde");
  await connectorsCard.getByRole("button", { name: "Save" }).click();
  await connectorsCard.getByText("Team hook").first().waitFor();
  await page.goto(`${meeting}/settings`);
  await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "Notifications" }).click();
  await page.getByRole("button", { name: "Suggested set for Team hook" }).click();
  await page
    .getByRole("button", { name: /Conditions and message/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Add a condition" }).click();
  await page.getByLabel("Title").fill("{meeting}: {missing} check-ins missing");
  await page.getByLabel("Text", { exact: true }).fill("Fill in your check-in before {time}: {link}");
  await page.locator(".wf-editor").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${process.env.SHOTS}/tour-9h-workflow.png` });
  // A Zoom account of the workspace, then the video panel of a meeting offers its lasting room (nothing is created here)
  await page.goto("/w/demo/settings");
  const videoCard = page.locator(".video-accounts");
  await videoCard.getByRole("button", { name: "Add a video account" }).click();
  await videoCard.getByLabel("Account ID").fill("a1B2c3D4e5");
  await videoCard.getByLabel("Client ID").fill("xYz123AbC");
  await videoCard.getByLabel("Client secret").fill("demo-secret");
  await videoCard.getByRole("button", { name: "Save" }).click();
  await videoCard.locator(".tracker-list li").first().waitFor();
  await page.goto(`${meeting}/settings`);
  await page.locator(".video-rooms").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${process.env.SHOTS}/tour-9i-video-rooms.png` });
  // A calendar account, then the schedule of a meeting offers it (nothing is sent to Google here)
  await page.goto("/w/demo/settings");
  const calCard = page.locator(".calendar-accounts");
  await calCard.getByRole("button", { name: "Add a calendar account" }).click();
  await calCard.getByLabel("Email of the service account").fill("ronde@acme.iam.gserviceaccount.com");
  await calCard.getByLabel("Organizer of the events").fill("rooms@acme.com");
  await calCard.getByLabel("Private key of the service account").fill("-----BEGIN PRIVATE KEY-----demo");
  await calCard.getByRole("button", { name: "Save" }).click();
  await calCard.locator(".tracker-list li").first().waitFor();
  await calCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${process.env.SHOTS}/tour-9j-calendars.png` });
  await page.goto(`${meeting}/settings`);
  await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "Schedule" }).click();
  await page.locator(".calendar-sync").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${process.env.SHOTS}/tour-9k-calendar-sync.png` });
  // Transcription: the service of the workspace, the meeting allows it, the control room offers to record
  await page.goto("/w/demo/settings");
  const stt = page.locator(".transcription-settings");
  await stt.getByLabel("Turn on transcription").check();
  await stt.getByLabel("API key").fill("sk-demo-0000");
  await stt.getByRole("button", { name: "Save" }).click();
  await stt.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  await page.goto(`${meeting}/settings`);
  await page.getByLabel("Allow recording the sessions for their transcript").check();
  await page.goto(`${meeting}/control`);
  await page.getByRole("button", { name: "Record" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${process.env.SHOTS}/tour-9l-record-consent.png` });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.goto(`${meeting}/history`);
  await page
    .getByRole("button", { name: /Show the transcript/ })
    .first()
    .click();
  await shot(page, "9m-transcript");
  await page.goto(`${meeting}/history`);
  await page.locator(".hist-card, .hcard, [class*=hist]").first().waitFor();
  await page
    .getByRole("button", { name: /Suggest actions/ })
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  await shot(page, "9e-history-ai");
  await page.getByRole("button", { name: "Fold the sidebar" }).click();
  await page.goto(`${meeting}/control`);
  await page
    .getByRole("button", { name: "Skip the tour" })
    .click({ timeout: 3000 })
    .catch(() => {});
  await shot(page, "10-control-folded");
  await page.getByRole("button", { name: "Unfold the sidebar" }).click();
  // Phone: the sidebar becomes a drawer
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/w/demo");
  await shot(page, "11-phone");
  await page.getByRole("button", { name: "Open the menu" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${process.env.SHOTS}/tour-12-phone-menu.png` });
});
