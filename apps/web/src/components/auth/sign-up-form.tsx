"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { authClient, failureKey, safeNext } from "@/lib/auth-client";
import { withBasePath } from "@/lib/shared/base-path";
import { track } from "@/lib/shared/track";
import { NewTab } from "../shell/new-tab";
import { Field, FormAlert, PasswordInput } from "./fields";
import { ProviderButtons, type ProviderInfo } from "./providers";

type FailureKey = ReturnType<typeof failureKey>;

export function SignUpForm({
  providers,
  next: rawNext,
  email: invitedEmail,
  mailConfigured,
  legal = null,
}: {
  providers: ProviderInfo[];
  next?: string;
  email?: string;
  mailConfigured: boolean;
  /** The terms and privacy policy an account accepts (the cloud); none on a self-hosted instance */
  legal?: { terms: string; privacy: string } | null;
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const next = safeNext(rawNext);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitedEmail ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FailureKey | null>(null);
  const [verify, setVerify] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setError("weakPassword");
    setBusy(true);
    setError(null);
    const locale = document.documentElement.lang || undefined;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { data, error } = await authClient.signUp.email({ name, email, password, locale, timezone, callbackURL: withBasePath(next) });
    if (error) {
      setBusy(false);
      setError(failureKey(error));
      return;
    }
    track("signup");
    // Without a session token, the address must be confirmed first
    if (!data?.token) {
      setVerify(true);
      return;
    }
    router.replace(next);
    router.refresh();
  };

  if (verify) {
    return (
      <div className="auth-body">
        <h1>{t("checkEmailTitle")}</h1>
        <p>{t.rich("checkEmailVerify", { email, strong: (c) => <strong>{c}</strong> })}</p>
        {!mailConfigured && <p className="hint">{t("noMailServer")}</p>}
        <Link href="/sign-in" className="link">
          {t("backToSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <div className="auth-body">
      <header className="auth-title">
        <h1>{t("signUpTitle")}</h1>
        <p className="muted">{t("signUpIntro")}</p>
      </header>
      <FormAlert>{error && t(`failure.${error}`)}</FormAlert>
      <ProviderButtons providers={providers} next={next} onError={setError} />
      {providers.length > 0 && <div className="divider">{t("orEmail")}</div>}
      <form className="auth-form" onSubmit={submit}>
        <Field label={t("name")}>
          {(p) => <input {...p} type="text" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t("email")}>
          {(p) => <input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field
          label={t("password")}
          hint={
            <span className={`pw-rule${password.length >= 10 ? " ok" : ""}`}>
              <span aria-hidden="true">{password.length >= 10 ? "✓" : "○"}</span> {t("passwordHint")}
            </span>
          }
          error={error === "weakPassword" ? t("failure.weakPassword") : null}
        >
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <button type="submit" className="btn primary big" disabled={busy} aria-busy={busy}>
          {t("signUp")}
        </button>
        {legal && (
          <p className="hint auth-legal">
            {t.rich("acceptTerms", {
              terms: (c) => (
                <a href={legal.terms} target="_blank" rel="noopener" className="ext">
                  {c}
                  <NewTab />
                </a>
              ),
              privacy: (c) => (
                <a href={legal.privacy} target="_blank" rel="noopener" className="ext">
                  {c}
                  <NewTab />
                </a>
              ),
            })}
          </p>
        )}
      </form>
      <p className="auth-foot">
        {t.rich("haveAccount", { link: (c) => <Link href={`/sign-in${rawNext ? `?next=${encodeURIComponent(next)}` : ""}`}>{c}</Link> })}
      </p>
    </div>
  );
}
