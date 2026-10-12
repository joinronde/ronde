"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { inferAdditionalFields, magicLinkClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { withBasePath } from "./shared/base-path";

export const authClient = createAuthClient({
  basePath: withBasePath("/api/auth"),
  plugins: [
    inferAdditionalFields({ user: { locale: { type: "string", required: false }, timezone: { type: "string", required: false } } }),
    magicLinkClient(),
    passkeyClient(),
    twoFactorClient({
      // Password accepted, a code is still needed: continue on the verification page
      onTwoFactorRedirect: () => {
        const next = new URLSearchParams(window.location.search).get("next");
        window.location.href = withBasePath(`/sign-in/two-factor${next ? `?next=${encodeURIComponent(next)}` : ""}`);
      },
    }),
  ],
});

/** Better Auth error codes mapped to the "auth.failure" messages */
export function failureKey(error: { code?: string; status?: number; message?: string } | null | undefined) {
  const code = error?.code ?? "";
  if (error?.status === 429) return "tooManyRequests" as const;
  if (code === "INVALID_EMAIL_OR_PASSWORD" || code === "INVALID_PASSWORD" || code === "CREDENTIAL_ACCOUNT_NOT_FOUND")
    return "invalidCredentials" as const;
  if (code === "EMAIL_NOT_VERIFIED") return "emailNotVerified" as const;
  if (code.startsWith("USER_ALREADY_EXISTS")) return "userExists" as const;
  if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") return "weakPassword" as const;
  if (code === "INVALID_CODE" || code === "INVALID_BACKUP_CODE" || code === "INVALID_TWO_FACTOR_COOKIE") return "invalidCode" as const;
  if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED") return "linkExpired" as const;
  if (code === "SSO_REQUIRED" || error?.message?.includes("SSO_REQUIRED")) return "ssoRequired" as const;
  if (code === "TWO_FACTOR_REQUIRED") return "twoFactorRequired" as const;
  if (error?.message?.includes("SIGNUP_NOT_ALLOWED") || code === "SIGNUP_NOT_ALLOWED") return "signupNotAllowed" as const;
  if (code === "SSO_NO_PROVIDER") return "ssoNoProvider" as const;
  if (code === "ACCOUNT_DISABLED" || error?.message?.includes("ACCOUNT_DISABLED")) return "accountDisabled" as const;
  if (code.startsWith("PASSKEY") || code.includes("PASSKEY") || code === "AUTHENTICATION_FAILED") return "passkeyFailed" as const;
  return "generic" as const;
}

/** The browser's passkey dialog was closed or stopped (by the person, or by a newer request): nothing to report */
export const passkeyDismissed = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === "AUTH_CANCELLED" || !!error.code?.startsWith("ERROR_") || /cancel/i.test(error.message ?? ""));

export { safeNext } from "./shared/safe-next";
