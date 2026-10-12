import type { DataCollection } from "@sentry/core";

/**
 * What error reports may carry: the technical error, the page and the browser, never the people's data. No user,
 * cookie, query string, request body, database values or local variables (they may hold a check-in's text).
 */
export const SENTRY_DATA: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ["user-agent", "accept-language", "content-type"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  genAI: { inputs: false, outputs: false },
};

/** Paths whose next segment is a secret (a guest link, an invitation, a feed, a sign-in or unsubscribe link) */
const SECRET_SEGMENT = /\/(g|invite|unsubscribe|reset-password|verify|magic-link|calendar|link|scim\/v2)\/[^/?#\s]+/g;
const EMAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/gi;

/** An address or a message as an error report may carry it: secret segments and email addresses taken out */
/** Query values that carry a credential (a sign-in link's token, an OAuth code or state, a signature) */
const SECRET_QUERY = /([?&](?:token|code|state|t|sig|signature|key|callbackURL)=)[^&#\s]*/gi;

export const scrubText = (text: string) => text.replace(SECRET_SEGMENT, "/$1/…").replace(SECRET_QUERY, "$1…").replace(EMAIL, "…@…");

type Scrubbable = {
  request?: { url?: string };
  transaction?: string;
  message?: string;
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: Breadcrumb[];
};
type Breadcrumb = { category?: string; message?: string; data?: Record<string, unknown> };

/** Before an event leaves: its addresses, messages and breadcrumbs scrubbed */
export function scrubEvent<E extends Scrubbable>(event: E): E {
  if (event.request?.url) event.request.url = scrubText(event.request.url);
  if (event.transaction) event.transaction = scrubText(event.transaction);
  if (event.message) event.message = scrubText(event.message);
  for (const v of event.exception?.values ?? []) if (v.value) v.value = scrubText(v.value);
  event.breadcrumbs = event.breadcrumbs?.flatMap((b) => {
    const kept = scrubBreadcrumb(b);
    return kept ? [kept] : [];
  });
  return event;
}

/** A breadcrumb kept without what the console printed (it may name people), its addresses scrubbed */
export function scrubBreadcrumb<B extends Breadcrumb>(b: B): B | null {
  if (b.category === "console") return null;
  if (b.message) b.message = scrubText(b.message);
  if (b.data) for (const k of ["url", "from", "to"]) if (typeof b.data[k] === "string") b.data[k] = scrubText(b.data[k] as string);
  return b;
}
