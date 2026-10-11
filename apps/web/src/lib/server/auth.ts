import "server-only";
import { passkey } from "@better-auth/passkey";
import { authEmail } from "@ronde/core/emails";
import { prisma } from "@ronde/db";
import { resolveLocale } from "@ronde/i18n";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth, magicLink, twoFactor } from "better-auth/plugins";
import { enterprise } from "@/ee-bridge";
import { captured, captureNewUser, ssoRequired } from "./domains";
import { env } from "./env";
import { companyIdentity, INTERNAL_HEADER, INTERNAL_TOKEN, identityHost, SSO_ADMIN_PATHS, trustedOrigins } from "./identity";
import { instanceSettings } from "./instance";
import { canSendEmail, sendEmail } from "./mailer";
import { authPrisma } from "./sso-secrets";

/** Language of an account email: the user's choice, otherwise the instance default */
const emailLocale = async (user?: { locale?: string | null }) => resolveLocale(user?.locale, (await instanceSettings()).defaultLocale);

/** Whether a new account may be created for this email, according to the sign-up policy */
export async function signupAllowed(email: string): Promise<boolean> {
  // The very first account (the instance administrator) is always allowed
  if ((await prisma.user.count()) === 0) return true;
  const { signupPolicy: policy, signupDomains } = await instanceSettings();
  if (policy === "open") return true;
  const address = email.trim().toLowerCase();
  // A workspace capturing the address's domain lets its people in (Enterprise)
  if (await captured(address)) return true;
  // Its company signs it in (own identity provider or directory)
  if (await companyIdentity(address)) return true;
  if (policy === "domains" && signupDomains.includes(address.split("@")[1] ?? "")) return true;
  // Invited people may always create their account
  const invitation = await prisma.invitation.findFirst({
    where: { email: { equals: address, mode: "insensitive" }, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return !!invitation;
}

const oidc = env.oidc();

/** Sign-in and sign-up paths that bypass single sign-on */
const SSO_GUARDED = new Set(["/sign-in/email", "/sign-up/email", "/sign-in/magic-link", "/request-password-reset", "/forget-password"]);
const social = env.social();

export const auth = betterAuth({
  appName: "Ronde",
  baseURL: env.appUrl() || "http://localhost:3000",
  secret: env.authSecret(),
  // The SSO providers' client secrets are encrypted in the table (sso-secrets.ts)
  database: prismaAdapter(authPrisma as unknown as typeof prisma, { provider: "postgresql" }),
  session: { modelName: "authSession", expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  user: {
    additionalFields: {
      locale: { type: "string", required: false },
      timezone: { type: "string", required: false },
      instanceRole: { type: "string", required: false, input: false, defaultValue: "user" },
    },
  },
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google", "github", "microsoft", "oidc"] },
    // The tokens Google, GitHub, Microsoft or the identity provider give at sign-in are kept encrypted
    encryptOAuthTokens: true,
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    // Without a mail server nobody could ever confirm an address: verification is then skipped
    requireEmailVerification: canSendEmail(),
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({ to: user.email, ...authEmail("resetPassword", { url, locale: await emailLocale(user as { locale?: string }) }) });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({ to: user.email, ...authEmail("verify", { url, locale: await emailLocale(user as { locale?: string }) }) });
    },
  },
  socialProviders: {
    ...(social.google ? { google: social.google } : {}),
    ...(social.github ? { github: social.github } : {}),
    ...(social.microsoft ? { microsoft: { ...social.microsoft, tenantId: process.env.MICROSOFT_TENANT_ID || "common" } } : {}),
  },
  plugins: [
    magicLink({
      expiresIn: 600,
      sendMagicLink: async ({ email, url }) => {
        const user = await prisma.user.findUnique({ where: { email }, select: { locale: true } });
        await sendEmail({ to: email, ...authEmail("magicLink", { url, locale: await emailLocale(user ?? undefined) }) });
      },
    }),
    genericOAuth({
      config: oidc
        ? [
            {
              providerId: "oidc",
              discoveryUrl: oidc.discoveryUrl,
              clientId: oidc.clientId,
              clientSecret: oidc.clientSecret,
              scopes: oidc.scopes,
              pkce: true,
            },
          ]
        : [],
    }),
    twoFactor({ issuer: "Ronde" }),
    // Passkeys, bound to the app's host name: only its own pages can ask for them
    passkey({
      rpName: "Ronde",
      ...(env.appUrl() ? { rpID: new URL(env.appUrl()).hostname, origin: new URL(env.appUrl()).origin } : {}),
    }),
    // Paid editions: single sign-on per workspace (none in a pure Community build)
    ...(enterprise.identity.authPlugins(identityHost) as BetterAuthPlugin[]),
    // Lets server actions set the session cookie
    nextCookies(),
  ],
  hooks: {
    // Addresses of a domain requiring single sign-on cannot use a password or an email link (Enterprise)
    before: createAuthMiddleware(async (ctx) => {
      // The SSO plugin's administration is Ronde's: a workspace admin goes through its settings
      if (SSO_ADMIN_PATHS.includes(ctx.path) && ctx.headers?.get(INTERNAL_HEADER) !== INTERNAL_TOKEN)
        throw new APIError("FORBIDDEN", { message: "SSO_ADMIN_FORBIDDEN" });
      // A person whose company signs them in (single sign-on required) does not add a passkey around it
      if (ctx.path === "/passkey/generate-register-options") {
        const session = await getSessionFromCtx(ctx);
        if (session && (await ssoRequired(session.user.email)))
          throw new APIError("FORBIDDEN", { code: "SSO_REQUIRED", message: "SSO_REQUIRED" });
        return;
      }
      if (!SSO_GUARDED.has(ctx.path)) return;
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email === "string" && (await ssoRequired(email)))
        throw new APIError("FORBIDDEN", { code: "SSO_REQUIRED", message: "SSO_REQUIRED" });
    }),
    // A passkey added before single sign-on became required does not open a session either
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/passkey/verify-authentication") return;
      const created = ctx.context.newSession;
      if (created && (await ssoRequired(created.user.email))) {
        await ctx.context.internalAdapter.deleteSession(created.session.token);
        throw new APIError("FORBIDDEN", { code: "SSO_REQUIRED", message: "SSO_REQUIRED" });
      }
    }),
  },
  databaseHooks: {
    // An account disabled by the Ronde team cannot open a session, whatever the way of signing in
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { disabledAt: true } });
          if (user?.disabledAt) throw new APIError("FORBIDDEN", { code: "ACCOUNT_DISABLED", message: "ACCOUNT_DISABLED" });
        },
      },
    },
    user: {
      create: {
        before: async (user) => {
          if (!(await signupAllowed(user.email))) throw new APIError("FORBIDDEN", { message: "SIGNUP_NOT_ALLOWED" });
          // The first account administers the instance
          const first = (await prisma.user.count()) === 0;
          return { data: { ...user, instanceRole: first ? "admin" : "user" } };
        },
        // Workspaces capturing the address's domain get their new member (Enterprise)
        after: async (user) => {
          await captureNewUser(user).catch((e) => console.error("[domains] capture failed", e));
        },
      },
    },
  },
  // Sign-in and sign-up attempts are limited per address in production; browser tests turn it off
  rateLimit: { enabled: process.env.NODE_ENV === "production" && process.env.AUTH_RATE_LIMIT !== "off" },
  advanced: {
    cookiePrefix: "ronde",
    // The client's address for the sign-in rate limit: behind the proxies listed (CIDR), the last address they
    // did not add; without the list, only a single-address header is believed (a forged chain shares one limit)
    ...(env.trustedProxies().length ? { ipAddress: { trustedProxies: env.trustedProxies() } } : {}),
  },
  // The app, and the identity providers of the workspaces (their OIDC discovery documents)
  trustedOrigins: () => trustedOrigins(),
});

export type AuthSession = typeof auth.$Infer.Session;

/** Providers that count as single sign-on for a domain requiring it (the organisation's identity provider) */
export const SSO_PROVIDERS = new Set(["oidc"]);

/** Sign-in buttons to show: configured social providers and the generic OIDC provider */
export function signInProviders(): { id: string; name: string }[] {
  const list: { id: string; name: string }[] = [];
  if (oidc) list.push({ id: "oidc", name: oidc.displayName });
  if (social.google) list.push({ id: "google", name: "Google" });
  if (social.microsoft) list.push({ id: "microsoft", name: "Microsoft" });
  if (social.github) list.push({ id: "github", name: "GitHub" });
  return list;
}

/** Whether the sign-up form is offered to visitors without an invitation */
export async function signupOpen(): Promise<boolean> {
  return (await instanceSettings()).signupPolicy !== "invite-only" || (await prisma.user.count()) === 0;
}
