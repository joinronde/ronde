import type { Instrumentation } from "next";
import { SENTRY_DATA } from "./lib/shared/sentry-privacy";

// Runs once when the Next.js server starts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Error reports, when the instance has a Sentry project (SENTRY_DSN): none of the people's data goes there
  if (process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || "production",
      release: process.env.RONDE_VERSION,
      dataCollection: SENTRY_DATA,
      tracesSampleRate: Math.min(1, Math.max(0, Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0)),
      initialScope: { tags: { component: "app" } },
    });
  }
  // Background jobs (reminders, sessions to prepare) run in the web process unless turned off
  if (process.env.RONDE_JOBS === "off") return;
  const { startBackgroundJobs } = await import("./lib/server/jobs");
  // The database may still be starting (a whole stack deployed at once): tried again until it answers
  const start = (attempt: number) =>
    startBackgroundJobs().catch((e) => {
      const wait = Math.min(60, 5 * attempt);
      console.error(`[jobs] cannot start, trying again in ${wait} s`, e);
      setTimeout(() => void start(attempt + 1), wait * 1000);
    });
  await start(1);
}

/** Errors of server rendering and route handlers, to Sentry when it is set up */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
