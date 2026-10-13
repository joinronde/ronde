import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Accessibility audit of the page as it is drawn (WCAG 2.1 AA rules of axe); a violation fails the test softly */
export async function audit(page: Page, label: string) {
  // axe reads colours as they are drawn: animations and transitions are skipped to their end first
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
  await page.waitForTimeout(300);
  // The email preview is an iframe of an email, not of the app: left out
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("iframe").analyze();
  const report = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes.map((n) => `${n.target.join(" ")} [${(n.failureSummary ?? "").replace(/\s+/g, " ")}]`).join(" | ")}`,
  );
  expect.soft(report, `${label}\n${report.join("\n")}`).toEqual([]);
}
