import type { Instrumentation } from "next";
import { SENTRY_DATA, scrubBreadcrumb, scrubEvent } from "./lib/shared/sentry-privacy";

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
      // Secret links and addresses never leave in a report
      beforeSend: (event) => scrubEvent(event),
      beforeSendTransaction: (event) => scrubEvent(event),
      beforeBreadcrumb: (b) => scrubBreadcrumb(b),
      tracesSampleRate: Math.min(1, Math.max(0, Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0)),
      initialScope: { tags: { component: "app" } },
    });
  }
  // Stopping (a deploy, a restart): the background jobs running end first, then the process
  let stopJobs: () => Promise<void> = async () => {};
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      void stopJobs()
        .catch((e) => console.error("[jobs] stopping", e))
        .finally(() => process.exit(0));
    });
  // Background jobs (reminders, sessions to prepare) run in the web process unless turned off
  if (process.env.RONDE_JOBS === "off") return;
  const { startBackgroundJobs } = await import("./lib/server/jobs");
  // The database may still be starting (a whole stack deployed at once): tried again until it answers
  const start = (attempt: number) =>
    startBackgroundJobs()
      .then((runner) => {
        stopJobs = runner.stop;
      })
      .catch((e) => {
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
