import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ScopedClient } from "@ronde/db";
import { type GitlabGrant, type GitlabTokenAnswer, grantOf } from "@/lib/shared/gitlab-grant";
import { env } from "./env";
import { IntegrationError, OpError } from "./errors";
import { outboundFetch } from "./outbound";
import { publicUrl } from "./public-url";
import { canEncrypt, encryptSecret } from "./secrets";

// "Connect with GitLab": an OAuth application of the GitLab server (GITLAB_OAUTH_CLIENT_ID and _SECRET) lets a
// meeting's host connect their account instead of pasting a personal token that expires. The grant is kept
// encrypted in the meeting's GitLab module and renewed with its refresh token before it runs out.

/** Whether this instance has a GitLab OAuth application */
export const gitlabOAuthOn = () => !!env.gitlabOAuthClientId() && !!env.gitlabOAuthClientSecret();

const STATE_TTL_MS = 10 * 60_000;
const stateMac = (payload: string) => createHmac("sha256", env.authSecret()).update(`gitlab-oauth:${payload}`).digest("base64url");

/** The "state" of the round trip: which meeting, for whom, until when; signed */
export function connectState(meetingId: string, userId: string, now = Date.now()): string {
  const payload = `${meetingId}.${userId}.${now + STATE_TTL_MS}`;
  return `${payload}.${stateMac(payload)}`;
}

export function readConnectState(state: string, now = Date.now()): { meetingId: string; userId: string } | null {
  const [meetingId, userId, until, mac, ...rest] = state.split(".");
  if (!meetingId || !userId || !until || !mac || rest.length) return null;
  const [a, b] = [Buffer.from(mac), Buffer.from(stateMac(`${meetingId}.${userId}.${until}`))];
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return Number(until) > now ? { meetingId, userId } : null;
}

const redirectUri = () => publicUrl("/api/gitlab/oauth");

/** GitLab's consent page; reading the API is all Ronde asks */
export async function connectUrl(meetingId: string, userId: string): Promise<string> {
  if (!gitlabOAuthOn()) throw new OpError("gitlabOAuthOff");
  if (!canEncrypt()) throw new OpError("encryptionNotConfigured");
  const q = new URLSearchParams({
    client_id: env.gitlabOAuthClientId(),
    redirect_uri: await redirectUri(),
    response_type: "code",
    state: connectState(meetingId, userId),
    scope: "read_api read_user",
  });
  return `${env.gitlabUrl()}/oauth/authorize?${q}`;
}

async function tokenRequest(body: Record<string, string>): Promise<GitlabTokenAnswer> {
  const res = await outboundFetch(`${env.gitlabUrl()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: env.gitlabOAuthClientId(),
      client_secret: env.gitlabOAuthClientSecret(),
      redirect_uri: await redirectUri(),
      ...body,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new IntegrationError("gitlabUnreachable", { url: env.gitlabUrl() });
  });
  if (!res.ok) throw new IntegrationError("gitlabTokenRefused");
  return (await res.json()) as GitlabTokenAnswer;
}

/** Back from GitLab with a code: the grant, with the account it belongs to */
export async function exchangeCode(code: string): Promise<GitlabGrant> {
  const answer = await tokenRequest({ grant_type: "authorization_code", code });
  const me = await outboundFetch(`${env.gitlabUrl()}/api/v4/user`, {
    headers: { Authorization: `Bearer ${answer.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
    .then((r): Promise<{ username?: string }> => (r.ok ? r.json() : Promise.resolve({})))
    .catch((): { username?: string } => ({}));
  return grantOf(answer, me.username ?? "");
}

/** A new access token from the refresh token (GitLab hands a new refresh token too) */
export async function renewGrant(grant: GitlabGrant): Promise<GitlabGrant> {
  return grantOf(await tokenRequest({ grant_type: "refresh_token", refresh_token: grant.refresh }), grant.user);
}

/** The grant kept in the meeting's GitLab module (installed if it was not) */
export async function saveGrant(db: ScopedClient, workspaceId: string, meetingId: string, grant: GitlabGrant) {
  const secret = encryptSecret(JSON.stringify(grant));
  await db.moduleInstallation.upsert({
    where: { meetingId_moduleId: { meetingId, moduleId: "gitlab" } },
    create: { workspaceId, meetingId, moduleId: "gitlab", enabled: true, config: {}, secret },
    update: { secret },
  });
}
