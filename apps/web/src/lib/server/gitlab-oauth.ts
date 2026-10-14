import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { gitlab } from "@ronde/modules";
import { type GitlabGrant, type GitlabTokenAnswer, grantOf } from "@/lib/shared/gitlab-grant";
import { env } from "./env";
import { AccessError, IntegrationError, OpError } from "./errors";
import { moduleAllowed } from "./meeting/modules";
import { outboundFetch } from "./outbound";
import { publicUrl } from "./public-url";
import { canEncrypt } from "./secrets";

// "Connect with GitLab": an OAuth application of the GitLab server (GITLAB_OAUTH_CLIENT_ID and _SECRET) makes a
// connection without pasting a personal token that expires: one of the workspace, made by an administrator, or
// a meeting's own, made by its host. The grant is kept encrypted in the connection and renewed with its refresh
// token before it runs out.

/** Whether this instance has a GitLab OAuth application, for an edition that has the GitLab module */
export const gitlabOAuthOn = () => !!env.gitlabOAuthClientId() && !!env.gitlabOAuthClientSecret() && moduleAllowed(gitlab);

const STATE_TTL_MS = 10 * 60_000;
const stateMac = (payload: string) => createHmac("sha256", env.authSecret()).update(`gitlab-oauth:${payload}`).digest("base64url");

/** Where a round trip goes: a new connection of the workspace or of a meeting, or a connection connected again */
export interface ConnectTarget {
  workspaceId: string;
  /** Null: the workspace's */
  meetingId: string | null;
  /** Null: a new connection */
  connectionId: string | null;
  userId: string;
}

const NONE = "_";

/** The "state" of the round trip: where it goes, for whom, until when; signed */
export function connectState(target: ConnectTarget, now = Date.now()): string {
  const payload = [target.workspaceId, target.meetingId ?? NONE, target.connectionId ?? NONE, target.userId, now + STATE_TTL_MS].join(".");
  return `${payload}.${stateMac(payload)}`;
}

export function readConnectState(state: string, now = Date.now()): ConnectTarget | null {
  const [workspaceId, meetingId, connectionId, userId, until, mac, ...rest] = state.split(".");
  if (!workspaceId || !meetingId || !connectionId || !userId || !until || !mac || rest.length) return null;
  const [a, b] = [Buffer.from(mac), Buffer.from(stateMac([workspaceId, meetingId, connectionId, userId, until].join(".")))];
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!(Number(until) > now)) return null;
  return {
    workspaceId,
    meetingId: meetingId === NONE ? null : meetingId,
    connectionId: connectionId === NONE ? null : connectionId,
    userId,
  };
}

const redirectUri = () => publicUrl("/api/gitlab/oauth");

/** GitLab's consent page; reading the API is all Ronde asks */
export async function connectUrl(target: ConnectTarget): Promise<string> {
  // The module's own edition first: connecting must not open what its operations refuse
  if (!moduleAllowed(gitlab)) throw new AccessError(403, "moduleNotInEdition");
  if (!gitlabOAuthOn()) throw new OpError("gitlabOAuthOff");
  if (!canEncrypt()) throw new OpError("encryptionNotConfigured");
  const q = new URLSearchParams({
    client_id: env.gitlabOAuthClientId(),
    redirect_uri: await redirectUri(),
    response_type: "code",
    state: connectState(target),
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

/** Where the person comes back: the integrations of the meeting, or the forges of the workspace's settings */
export const connectBack = (slug: string, meetingId: string | null, result: string) =>
  publicUrl(meetingId ? `/w/${slug}/m/${meetingId}/settings?gitlab=${result}#integrations` : `/w/${slug}/settings?gitlab=${result}#forges`);
