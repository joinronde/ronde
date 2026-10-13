import { defineConfig, devices } from "@playwright/test";
import { STRIPE_PORT, STRIPE_WEBHOOK_SECRET } from "./e2e/cloud/stripe-fake";
import base from "./playwright.config";

// The paid features in a browser: the cloud, where each workspace has its own plan (no license key needed).
// Its own server on another port, run after the main flows (pnpm e2e:cloud).
const PORT = Number(process.env.E2E_CLOUD_PORT ?? 3201);
const baseURL = `http://localhost:${PORT}`;
const server = Array.isArray(base.webServer) ? base.webServer[0]! : base.webServer!;

export default defineConfig({
  ...base,
  testDir: "e2e/cloud",
  testIgnore: [],
  use: { ...base.use, baseURL },
  projects: [{ name: "cloud", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    ...server,
    command: String(server.command).replaceAll(String(process.env.E2E_PORT ?? 3200), String(PORT)),
    url: `${baseURL}/api/health`,
    // Billing against the fake Stripe that e2e/cloud/billing.spec.ts starts (stripe-fake.ts)
    env: {
      ...server.env,
      APP_URL: baseURL,
      RONDE_CLOUD: "1",
      STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}/v1`,
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET,
      STRIPE_PRICE_TEAM: "price_team_monthly",
      STRIPE_PRICE_TEAM_YEARLY: "price_team_yearly",
    },
  },
});
