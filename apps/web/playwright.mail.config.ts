import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// The flows that need an email (password reset, sign-in link, address check): their own server, which sends
// through SMTP to a small fake mail server the specs start (e2e/mail/inbox.ts). With a mail server, new
// addresses must be confirmed, so these flows cannot share the main server. Run with pnpm e2e:mail.
const PORT = Number(process.env.E2E_MAIL_PORT ?? 3202);
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 2526);
const baseURL = `http://localhost:${PORT}`;
const server = Array.isArray(base.webServer) ? base.webServer[0]! : base.webServer!;

export default defineConfig({
  ...base,
  testDir: "e2e/mail",
  testIgnore: [],
  // One fake mail server, on one port: one worker
  workers: 1,
  use: { ...base.use, baseURL },
  projects: [{ name: "mail", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    ...server,
    command: String(server.command).replaceAll(String(process.env.E2E_PORT ?? 3200), String(PORT)),
    url: `${baseURL}/api/health`,
    env: { ...server.env, APP_URL: baseURL, SMTP_URL: `smtp://127.0.0.1:${SMTP_PORT}`, MAIL_FROM: "Ronde <ronde@example.com>" },
  },
});
