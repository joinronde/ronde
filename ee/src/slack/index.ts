// Ronde Enterprise Edition. Copyright (c) Ronde. Licensed under the Ronde Enterprise License (see ee/LICENSE).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { EnterpriseEdition, SlackApp, SlackInstall } from "@ronde/editions/ee";

// The Slack app of a workspace: installed with "Add to Slack" (OAuth v2), its requests to Ronde checked with
// the app's signing secret, and the Web API called with the bot's token (direct messages, forms, lookups).

const API = "https://slack.com/api";
/** Requests older than this are refused (replays) */
const TOLERANCE_S = 300;
/** What the app asks for: posting, its command, finding people by email, and the channel picked at install */
export const SCOPES = ["chat:write", "commands", "im:write", "users:read", "users:read.email", "incoming-webhook"];

export class SlackError extends Error {}

/** A request from Slack, signed with the app's signing secret: "v0=" + HMAC-SHA256 of "v0:<timestamp>:<body>" */
export function verify(body: string, timestamp: string, signature: string, signingSecret: string, now = Date.now()): boolean {
  const ts = Number(timestamp);
  if (!ts || !signature.startsWith("v0=") || !signingSecret || Math.abs(now / 1000 - ts) > TOLERANCE_S) return false;
  const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** The page where a Slack workspace's administrator adds the app */
export function authorizeUrl(app: SlackApp, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: app.clientId, scope: SCOPES.join(","), redirect_uri: redirectUri, state });
  return `https://slack.com/oauth/v2/authorize?${q}`;
}

/**
 * One Web API method, an error when Slack says so. Arguments go form-encoded, which every method accepts
 * (objects and lists, such as blocks or a view, as JSON); the answer comes back as JSON.
 */
export async function call<T = Record<string, unknown>>(
  token: string,
  method: string,
  args: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(args))
    if (v !== undefined && v !== null) form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  const res = await fetcher(`${API}/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !out.ok) throw new SlackError(out.error ?? `http_${res.status}`);
  return out as T;
}

/** The code of the OAuth redirect, exchanged for the installation: bot token, team, channel webhook */
export async function exchange(app: SlackApp, code: string, redirectUri: string, fetcher: typeof fetch = fetch): Promise<SlackInstall> {
  const res = await fetcher(`${API}/oauth.v2.access`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(10_000),
  });
  const o = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
    incoming_webhook?: { url?: string; channel?: string; channel_id?: string };
  };
  if (!o.ok || !o.access_token || !o.team?.id) throw new SlackError(`oauth.v2.access: ${o.error ?? "no installation"}`);
  return {
    teamId: o.team.id,
    teamName: o.team.name ?? "",
    botToken: o.access_token,
    botUserId: o.bot_user_id ?? "",
    webhookUrl: o.incoming_webhook?.url ?? "",
    channel: o.incoming_webhook?.channel ?? "",
  };
}

export const slack: EnterpriseEdition["slack"] = { verify, authorizeUrl, exchange, call };
