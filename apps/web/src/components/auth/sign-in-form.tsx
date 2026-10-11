"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { authClient, failureKey, passkeyDismissed, safeNext } from "@/lib/auth-client";
import { withBasePath } from "@/lib/shared/base-path";
import { Field, FormAlert, PasswordInput } from "./fields";
import { ProviderButtons, type ProviderInfo } from "./providers";

type FailureKey = ReturnType<typeof failureKey>;

export function SignInForm({
  providers,
  next: rawNext,
  initialError,
  mailConfigured,
  signupOpen,
  companySso = false,
  companyLdap = false,
}: {
  providers: ProviderInfo[];
  next?: string;
  initialError?: FailureKey | null;
  mailConfigured: boolean;
  signupOpen: boolean;
  /** Workspaces of this instance have their own single sign-on (Enterprise) */
  companySso?: boolean;
  /** Workspaces of this instance sign their people in with their company directory (Enterprise) */
  companyLdap?: boolean;
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const next = safeNext(rawNext);
  const [mode, setMode] = useState<"password" | "magic" | "sso">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FailureKey | null>(initialError ?? null);
  const [sent, setSent] = useState(false);
  // Passkeys, once the browser says it can use them
  const [passkeys, setPasskeys] = useState(false);

  /**
   * Sign-in with a passkey: from the button, or picked in the email field's suggestions (autoFill), which the
   * browser offers by itself once asked on load
   */
  const passkeySignIn = useCallback(
    async (autoFill = false) => {
      if (!autoFill) {
        setBusy(true);
        setError(null);
      }
      const { error } = await authClient.signIn.passkey({ autoFill });
      if (error) {
        setBusy(false);
        if (!passkeyDismissed(error)) setError(failureKey(error));
        return;
      }
      router.replace(next);
      router.refresh();
    },
    [next, router],
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.PublicKeyCredential) return;
    setPasskeys(true);
    void PublicKeyCredential.isConditionalMediationAvailable?.().then((ok) => {
      if (ok) void passkeySignIn(true);
    });
  }, [passkeySignIn]);

  /** Company single sign-on: the provider of the address's domain takes over */
  const companySignIn = async () => {
    const { data, error } = await authClient.$fetch<{ url: string }>("/sign-in/sso", {
      method: "POST",
      body: { email, callbackURL: withBasePath(next), errorCallbackURL: withBasePath("/sign-in") },
    });
    if (error || !data?.url) {
      setBusy(false);
      setError("ssoNoProvider");
      return;
    }
    window.location.href = data.url;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === "sso") return companySignIn();
    if (mode === "magic") {
      const { error } = await authClient.signIn.magicLink({
        email,
        callbackURL: withBasePath(next),
        errorCallbackURL: withBasePath("/sign-in"),
      });
      setBusy(false);
      if (error) setError(failureKey(error));
      else setSent(true);
      return;
    }
    // An address with a company directory signs in with the directory password
    if (companyLdap) {
      const { error: ldapError } = await authClient.$fetch("/sign-in/ldap", {
        method: "POST",
        body: { email, password, rememberMe: true },
      });
      if (!ldapError) {
        router.replace(next);
        router.refresh();
        return;
      }
      if (ldapError.status !== 404) {
        setBusy(false);
        setError("invalidCredentials");
        return;
      }
    }
    const { error } = await authClient.signIn.email({ email, password, rememberMe: true });
    if (error) {
      // The address must use its company's sign-in: go there directly
      if (companySso && failureKey(error) === "ssoRequired") return companySignIn();
      setBusy(false);
      setError(failureKey(error));
      return;
    }
    router.replace(next);
    router.refresh();
  };

  if (sent) {
    return (
      <div className="auth-body">
        <h1>{t("checkEmailTitle")}</h1>
        <p>{t.rich("checkEmailMagic", { email, strong: (c) => <strong>{c}</strong> })}</p>
        {!mailConfigured && <p className="hint">{t("noMailServer")}</p>}
        <button type="button" className="link-btn" onClick={() => setSent(false)}>
          {t("backToSignIn")}
        </button>
      </div>
    );
  }

  return (
    <div className="auth-body">
      <header className="auth-title">
        <h1>{t("signInTitle")}</h1>
        <p className="muted">{t("signInIntro")}</p>
      </header>
      <FormAlert>{error && t(`failure.${error}`)}</FormAlert>
      {passkeys && (
        <button type="button" className="btn provider passkey-btn" disabled={busy} onClick={() => void passkeySignIn()}>
          <PasskeyIcon /> {t("passkeySignIn")}
        </button>
      )}
      <ProviderButtons providers={providers} next={next} onError={setError} />
      {(providers.length > 0 || passkeys) && <div className="divider">{t("orEmail")}</div>}
      <div className="seg-toggle" role="radiogroup" aria-label={t("signInWith")}>
        {(companySso ? (["password", "magic", "sso"] as const) : (["password", "magic"] as const)).map((m) => (
          <label key={m} className={mode === m ? "on" : undefined}>
            <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
            {m === "password" ? t("modePassword") : m === "magic" ? t("modeLink") : t("modeSso")}
          </label>
        ))}
      </div>
      {mode === "magic" && <p className="hint">{t("magicHint")}</p>}
      {mode === "sso" && <p className="hint">{t("ssoHint")}</p>}
      <form className="auth-form" onSubmit={submit} noValidate={false}>
        <Field label={t("email")}>
          {(p) => (
            // "webauthn": the browser suggests the passkeys of this site right in the field
            <input {...p} type="email" autoComplete="username webauthn" required value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        {mode === "password" && (
          <Field
            label={t("password")}
            hint={
              <Link href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`} className="link">
                {t("forgotPassword")}
              </Link>
            }
          >
            {(p) => (
              <PasswordInput
                {...p}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
        )}
        <button type="submit" className="btn primary big" disabled={busy} aria-busy={busy}>
          {mode === "password" ? t("signIn") : mode === "magic" ? t("sendMagicLink") : t("continueSso")}
        </button>
      </form>
      {signupOpen && (
        <p className="auth-foot">
          {t.rich("noAccount", { link: (c) => <Link href={`/sign-up${rawNext ? `?next=${encodeURIComponent(next)}` : ""}`}>{c}</Link> })}
        </p>
      )}
    </div>
  );
}

/** The passkey mark: a person and a key */
export function PasskeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-1.5A5.5 5.5 0 0 1 7.5 14H11" />
      <circle cx="18" cy="13.5" r="2.5" />
      <path d="M18 16v5l1.5-1.2M18 19l1.5-1" />
    </svg>
  );
}
