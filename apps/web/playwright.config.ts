import { defineConfig, devices } from "@playwright/test";

// Browser flows against a dev server on the local database (make db). Accounts use unique addresses,
// so runs do not interfere with each other or with the demo data.
const PORT = Number(process.env.E2E_PORT ?? 3200);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  // The paid features run in the cloud mode, on their own server (playwright.cloud.config.ts); the flows that
  // need an email, on a server with a mail server (playwright.mail.config.ts)
  testIgnore: ["cloud/**", "mail/**"],
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // Pages are compiled on first visit by the dev server
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, locale: "en-US", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // E2E_BUILD=1 runs the production build (pnpm build first), e.g. while "next dev" is already running
    command: process.env.E2E_BUILD
      ? `cp -r public .next/standalone/apps/web/ && cp -r .next/static .next/standalone/apps/web/.next/ && PORT=${PORT} node .next/standalone/apps/web/server.js`
      : `next dev -p ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      SIGNUP_POLICY: "open",
      APP_URL: baseURL,
      SMTP_URL: "",
      AUTH_TRUSTED_EMAIL_HEADER: "",
      RONDE_JOBS: "off",
      // The "Send feedback" button, off by default on a self-hosted instance, is tested too
      RONDE_FEEDBACK: "on",
      // Every test signs up from the same address: the sign-in rate limit would refuse them
      AUTH_RATE_LIMIT: "off",
      ...(process.env.E2E_BUILD
        ? { AUTH_SECRET: "e2e-only-secret-0123456789abcdef-0123456789", SECRET_KEY: "e2e-only-encryption-key-0123456789abcdef" }
        : {}),
    },
  },
});
