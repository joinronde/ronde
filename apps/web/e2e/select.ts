import type { Locator, Page } from "@playwright/test";

/** Picks a value in one of Ronde's drawn selects (the stand-in for Playwright's selectOption) */
export async function choose(page: Page, select: Locator, value: string) {
  await select.click();
  await page.locator(`[role="listbox"] [role="option"][data-value="${value}"]`).click();
}
