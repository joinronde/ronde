import { BROWSER_NOISE, SENTRY_DATA, scrubBreadcrumb, scrubEvent } from "./lib/shared/sentry-privacy";

// Runs in the browser before the app starts. Error reports go to the instance's Sentry project when it has one:
// the root layout gives its address (SENTRY_DSN, read at run time), and the SDK is only downloaded then.

const meta = document.querySelector<HTMLMetaElement>('meta[name="ronde-sentry"]');
if (meta?.content)
  void import("@sentry/nextjs").then((Sentry) =>
    Sentry.init({
      dsn: meta.content,
      environment: meta.dataset.environment,
      release: meta.dataset.release || undefined,
      dataCollection: SENTRY_DATA,
      // Secret links and addresses never leave in a report
      beforeSend: (event) => scrubEvent(event),
      beforeSendTransaction: (event) => scrubEvent(event),
      beforeBreadcrumb: (b) => scrubBreadcrumb(b),
      tracesSampleRate: 0,
      // Microsoft's link scanner (Outlook Safe Links) opens the links of an email in a headless browser whose own
      // script rejects with this; no user is behind it. A visitor's connection that drops is not the app's error either
      ignoreErrors: [/Object Not Found Matching Id:\d+, MethodName:\w+, ParamCount:\d+/, ...BROWSER_NOISE],
      initialScope: { tags: { component: "app" } },
    }),
  );
