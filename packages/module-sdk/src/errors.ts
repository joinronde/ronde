import type { Messages } from "@ronde/i18n";

/** Key of a user-facing error message (the "errors" messages) */
export type ErrorKey = keyof Messages["errors"];
export type ErrorValues = Record<string, string | number>;

/** Error shown to the user, translated in their language when the response is built */
export class AppError extends Error {
  constructor(
    public key: ErrorKey,
    public values: ErrorValues = {},
    public status = 400,
  ) {
    super(key);
    // "Invalid request: {details}" without the details would show the placeholder
    if (key === "invalidRequest" && values.details === undefined) this.key = "invalidRequestPlain";
  }
}

/** Not signed in (401) or not allowed (403) */
export class AccessError extends AppError {
  constructor(status: 401 | 403, key: ErrorKey, values?: ErrorValues) {
    super(key, values, status);
  }
}

/** Invalid request or impossible operation */
export class OpError extends AppError {}

/** An external service (GitLab, Matrix…) refused or did not answer */
export class IntegrationError extends AppError {
  constructor(key: ErrorKey, values?: ErrorValues) {
    super(key, values, 502);
  }
}
