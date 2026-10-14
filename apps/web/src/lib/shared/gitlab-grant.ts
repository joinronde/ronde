// What a GitLab connection's secret holds: a personal token typed in the settings, or the grant of a "Connect with
// GitLab" round trip, renewed before it runs out. Pure, for the server-free tests

export interface GitlabGrant {
  kind: "oauth";
  access: string;
  refresh: string;
  /** When the access token runs out, in ms */
  expiresAt: number;
  /** The GitLab account that connected it */
  user: string;
}

/** GitLab's answer to a code or a refresh token */
export interface GitlabTokenAnswer {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  created_at?: number;
}

/** A minute's margin: a token renewed a little early never lapses in the middle of a request */
const MARGIN_MS = 60_000;
/** GitLab's tokens last two hours when it does not say */
const DEFAULT_TTL_S = 7200;

/** The secret as stored (decrypted): its grant when it is one, and the token to send either way */
export function parseGitlabSecret(plain: string): { token: string; grant: GitlabGrant | null } {
  if (plain.startsWith("{")) {
    try {
      const g = JSON.parse(plain) as Partial<GitlabGrant>;
      if (g.kind === "oauth" && typeof g.access === "string" && typeof g.refresh === "string" && typeof g.expiresAt === "number")
        return {
          token: g.access,
          grant: { kind: "oauth", access: g.access, refresh: g.refresh, expiresAt: g.expiresAt, user: g.user ?? "" },
        };
    } catch {
      /* not a grant: a token that happens to start with a brace */
    }
  }
  return { token: plain, grant: null };
}

/** Whether the access token must be renewed before use */
export const grantDue = (g: GitlabGrant, now = Date.now()) => g.expiresAt - MARGIN_MS <= now;

/** The grant to keep from GitLab's answer */
export function grantOf(answer: GitlabTokenAnswer, user: string, now = Date.now()): GitlabGrant {
  const from = answer.created_at ? answer.created_at * 1000 : now;
  return {
    kind: "oauth",
    access: answer.access_token,
    refresh: answer.refresh_token,
    expiresAt: from + (answer.expires_in ?? DEFAULT_TTL_S) * 1000,
    user,
  };
}
