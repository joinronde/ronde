import "server-only";
import { defaultLocale, isLocale, type Locale } from "@ronde/i18n";

// Secret variables can be given in clear or through <NAME>_FILE:
// docker/entrypoint.mjs turns the *_FILE variables into plain ones before start-up.

export const env = {
  databaseUrl: () => required("DATABASE_URL"),
  smtpUrl: () => process.env.SMTP_URL ?? "",
  mailFrom: () => process.env.MAIL_FROM || "Ronde <ronde@localhost>",
  /** Mailbox whose replies to reminders fill check-ins: imaps://user:password@host:993/INBOX (empty: off) */
  inboundImapUrl: () => process.env.INBOUND_IMAP_URL ?? "",
  /** Address replies are sent to; empty: the IMAP account's, when it is an email address */
  inboundAddress: () => process.env.INBOUND_ADDRESS ?? "",
  /** Web Push keys of the instance (VAPID: pnpm --filter @ronde/web push-keys); empty: no push notifications */
  webPushPublicKey: () => (process.env.WEB_PUSH_PUBLIC_KEY ?? "").trim(),
  webPushPrivateKey: () => (process.env.WEB_PUSH_PRIVATE_KEY ?? "").trim(),
  /** Contact the push services may use (mailto: or https:), the sender address by default */
  webPushSubject: () => {
    const own = (process.env.WEB_PUSH_SUBJECT ?? "").trim();
    if (own) return own;
    const from = /<([^>]+)>/.exec(process.env.MAIL_FROM ?? "")?.[1] ?? (process.env.MAIL_FROM || "").trim();
    return from.includes("@") && !from.endsWith("@localhost") ? `mailto:${from}` : "mailto:push@ronde.invalid";
  },
  /** Public URL of the app, prefix included (links in reminder emails) */
  appUrl: () => (process.env.APP_URL ?? "").replace(/\/$/, ""),
  /** Language used when neither the viewer nor their browser picks one */
  defaultLocale: (): Locale => (isLocale(process.env.DEFAULT_LOCALE) ? process.env.DEFAULT_LOCALE : defaultLocale),
  /** Encryption key of the tokens kept in the database; a fixed key outside production for local development */
  secretKey: () => process.env.SECRET_KEY || (process.env.NODE_ENV !== "production" ? "ronde-development-only-local-encryption-key" : ""),
  /**
   * Secret signing sessions and tokens (at least 32 characters); a fixed key outside production. `next build`
   * loads the auth module without serving anything: a placeholder avoids a spurious error there.
   */
  authSecret: () =>
    process.env.AUTH_SECRET ||
    (process.env.NODE_ENV !== "production"
      ? "ronde-development-only-auth-secret-0123456789"
      : process.env.NEXT_PHASE === "phase-production-build"
        ? "ronde-build-time-placeholder-never-used-to-sign"
        : ""),
  /** Who may create an account: "open", "invite-only" (default) or "domains" (SIGNUP_ALLOWED_DOMAINS) */
  signupPolicy: (): "open" | "invite-only" | "domains" => {
    const v = process.env.SIGNUP_POLICY;
    return v === "open" || v === "domains" ? v : "invite-only";
  },
  signupAllowedDomains: () =>
    (process.env.SIGNUP_ALLOWED_DOMAINS ?? "")
      .split(/[\s,;]+/)
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  /** Generic OpenID Connect provider (Keycloak, Authentik, Entra ID, Google Workspace…) */
  oidc: () => {
    const issuer = (process.env.OIDC_ISSUER ?? "").replace(/\/$/, "");
    const clientId = process.env.OIDC_CLIENT_ID ?? "";
    if (!issuer || !clientId) return null;
    return {
      discoveryUrl: process.env.OIDC_DISCOVERY_URL || `${issuer}/.well-known/openid-configuration`,
      clientId,
      clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
      displayName: process.env.OIDC_DISPLAY_NAME || "SSO",
      scopes: (process.env.OIDC_SCOPES || "openid profile email").split(/\s+/).filter(Boolean),
    };
  },
  /** Social sign-in, each provider turned on by its client id and secret */
  social: () => {
    const pair = (id?: string, secret?: string) => (id && secret ? { clientId: id, clientSecret: secret } : null);
    return {
      google: pair(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET),
      github: pair(process.env.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_SECRET),
      microsoft: pair(process.env.MICROSOFT_CLIENT_ID, process.env.MICROSOFT_CLIENT_SECRET),
    };
  },
  /**
   * Trusted-header sign-in for instances behind an authenticating reverse proxy (oauth2-proxy…): the header
   * named here carries the person's email. Never enable it on an instance reachable without that proxy.
   */
  trustedEmailHeader: () => (process.env.AUTH_TRUSTED_EMAIL_HEADER ?? "").toLowerCase(),
  /** Reverse proxies in front of Ronde (CIDR ranges): who may add to X-Forwarded-For */
  trustedProxies: () =>
    (process.env.RONDE_TRUSTED_PROXIES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  gitlabUrl: () => (process.env.GITLAB_URL || "https://gitlab.com").replace(/\/$/, ""),
  /** Public site of Ronde (plans, docs); never written in the code */
  siteUrl: () => (process.env.RONDE_SITE_URL || "https://joinronde.com").replace(/\/$/, ""),
  /**
   * Where the messages of the "Send feedback" button go: the Ronde team in the cloud, the instance's
   * administrators elsewhere (/admin); RONDE_FEEDBACK=off takes the button away
   */
  feedbackTo: (): "team" | "admins" | null =>
    process.env.RONDE_FEEDBACK === "off" ? null : process.env.RONDE_CLOUD === "1" ? "team" : "admins",
  /** Self-hosted instances can turn off every mention of the paid plans */
  hideUpgradeHints: () => process.env.RONDE_HIDE_UPGRADE_HINTS === "1",
  /** Fallback when no token is entered in the settings */
  gitlabToken: () => process.env.GITLAB_TOKEN ?? "",
  /** Key of the AI assistant for every workspace of the instance (cloud); a workspace may bring its own */
  anthropicKey: () => process.env.ANTHROPIC_API_KEY ?? "",
  /** Speech-to-text service for every workspace (an OpenAI key, or a self-hosted Whisper server) */
  /** STUN/TURN servers of screen sharing, as JSON; a public STUN server by default, "[]" for none */
  iceServers: (): { urls: string | string[]; username?: string; credential?: string }[] => {
    try {
      const v = JSON.parse(process.env.RONDE_ICE_SERVERS ?? "null");
      return Array.isArray(v) ? v : [{ urls: "stun:stun.l.google.com:19302" }];
    } catch {
      return [{ urls: "stun:stun.l.google.com:19302" }];
    }
  },
  /** Billing of the Ronde cloud (RONDE_CLOUD=1): Stripe keys and the price of a Team seat */
  stripeSecretKey: () => process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePriceTeam: () => process.env.STRIPE_PRICE_TEAM ?? "",
  /** The yearly price of a Team seat (optional: without it, only the monthly one is offered) */
  stripePriceTeamYearly: () => process.env.STRIPE_PRICE_TEAM_YEARLY ?? "",
  transcriptionUrl: () => process.env.TRANSCRIPTION_URL ?? "",
  transcriptionKey: () => process.env.TRANSCRIPTION_API_KEY ?? "",
  transcriptionModel: () => process.env.TRANSCRIPTION_MODEL ?? "",
  /** The instance's Slack app (api.slack.com/apps): workspaces add it with "Add to Slack" */
  slackClientId: () => process.env.SLACK_CLIENT_ID ?? "",
  slackClientSecret: () => process.env.SLACK_CLIENT_SECRET ?? "",
  slackSigningSecret: () => process.env.SLACK_SIGNING_SECRET ?? "",
  /**
   * The instance's Microsoft Teams app: the Microsoft Entra registration of its bot (application id and client
   * secret), and the tenant it belongs to (a single-tenant bot)
   */
  teamsAppId: () => process.env.TEAMS_APP_ID ?? "",
  teamsAppPassword: () => process.env.TEAMS_APP_PASSWORD ?? "",
  teamsTenantId: () => process.env.TEAMS_TENANT_ID ?? "",
  /** Error reports (optional): this instance's Sentry project; nothing is sent without it */
  sentryDsn: () => process.env.SENTRY_DSN ?? "",
  sentryEnvironment: () => process.env.SENTRY_ENVIRONMENT || "production",
  /** Audience measure (optional): an Umami server's script and this instance's website there */
  umami: () => ({
    src: process.env.UMAMI_SCRIPT_URL ?? "",
    websiteId: process.env.UMAMI_WEBSITE_ID ?? "",
    /** Only these host names are counted (a staging copy stays out), comma-separated */
    domains: process.env.UMAMI_DOMAINS ?? "",
  }),
  /** GitHub API: github.com by default, or a GitHub Enterprise Server (https://github.example.com/api/v3) */
  githubApiUrl: () => (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, ""),
  /** Fallback when no token is entered in the settings */
  githubToken: () => process.env.GITHUB_TOKEN ?? "",
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}
