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
