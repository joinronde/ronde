// Ronde Enterprise Edition. Copyright (c) Ronde. Licensed under the Ronde Enterprise License (see ee/LICENSE).
import { createSign } from "node:crypto";

// Accounts of the workspace at Google and Microsoft: a service account acting for a user of the domain,
// an Entra application with client credentials. Shared by video links and calendars.

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export async function call(f: Fetch | undefined, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await (f ?? fetch)(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {}
  if (!res.ok) {
    const detail = (body.error_description ?? body.reason ?? body.message ?? (body.error as { message?: string })?.message ?? body.error) as
      | string
      | undefined;
    throw new ProviderError(`${res.status}${detail && typeof detail === "string" ? `: ${detail}` : ""}`, res.status);
  }
  return body;
}

export const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

export const bearer = (token: string, method = "GET", body?: unknown): RequestInit => ({
  method,
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const b64url = (s: string) => Buffer.from(s).toString("base64url");

/** A Google access token for a user of the domain, through the service account's domain-wide delegation */
export async function googleToken(
  a: { config: Record<string, string>; secret: string; fetch?: Fetch },
  subject: string,
  scope: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: a.config.clientEmail,
      sub: subject,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  let signature: string;
  try {
    signature = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(a.secret.replace(/\\n/g, "\n"), "base64url");
  } catch {
    throw new ProviderError("the private key of the service account cannot be read");
  }
  const r = await call(
    a.fetch,
    "https://oauth2.googleapis.com/token",
    form({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${signature}` }),
  );
  return String(r.access_token);
}

/** A Microsoft Graph access token for the Entra application of the workspace */
export async function graphToken(a: { config: Record<string, string>; secret: string; fetch?: Fetch }): Promise<string> {
  const r = await call(
    a.fetch,
    `https://login.microsoftonline.com/${encodeURIComponent(a.config.tenant ?? "")}/oauth2/v2.0/token`,
    form({
      client_id: a.config.clientId ?? "",
      client_secret: a.secret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  );
  return String(r.access_token);
}

export const graphUser = (email: string) => `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}`;
