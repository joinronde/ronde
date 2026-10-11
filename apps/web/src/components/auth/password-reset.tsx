"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { authClient, failureKey } from "@/lib/auth-client";
import { withBasePath } from "@/lib/shared/base-path";
import { Field, FormAlert, PasswordInput } from "./fields";

type FailureKey = ReturnType<typeof failureKey>;

export function ForgotPasswordForm({ email: initial = "", mailConfigured }: { email?: string; mailConfigured: boolean }) {
  const t = useTranslations("auth");
  const [email, setEmail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FailureKey | null>(null);
  const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: withBasePath("/reset-password") });
    setBusy(false);
    if (error) setError(failureKey(error));
    else setSent(true);
  };
  return (
    <div className="auth-body">
      <h1>{sent ? t("checkEmailTitle") : t("forgotTitle")}</h1>
      {sent ? (
        <>
          <p>{t.rich("checkEmailReset", { email, strong: (c) => <strong>{c}</strong> })}</p>
          {!mailConfigured && <p className="hint">{t("noMailServer")}</p>}
        </>
      ) : (
        <>
          <p className="muted">{t("forgotIntro")}</p>
          <FormAlert>{error && t(`failure.${error}`)}</FormAlert>
          <form className="auth-form" onSubmit={submit}>
            <Field label={t("email")}>
              {(p) => <input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <button type="submit" className="btn primary big" disabled={busy} aria-busy={busy}>
              {t("sendResetLink")}
            </button>
          </form>
        </>
      )}
      <Link href="/sign-in" className="link">
        {t("backToSignIn")}
      </Link>
    </div>
  );
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const t = useTranslations("auth");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FailureKey | null>(token ? null : "linkExpired");
  const [done, setDone] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password.length < 10) return setError("weakPassword");
    setBusy(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (error) setError(failureKey(error));
    else setDone(true);
  };
  return (
    <div className="auth-body">
      <h1>{t("resetTitle")}</h1>
      {done ? (
        <FormAlert tone="ok">{t("resetDone")}</FormAlert>
      ) : (
        <>
          <FormAlert>
            {error && error !== "weakPassword" && (error === "linkExpired" ? t("resetInvalid") : t(`failure.${error}`))}
          </FormAlert>
          {token && (
            <form className="auth-form" onSubmit={submit}>
              <Field label={t("newPassword")} hint={t("passwordHint")} error={error === "weakPassword" ? t("failure.weakPassword") : null}>
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
                {t("savePassword")}
              </button>
            </form>
          )}
        </>
      )}
      <Link href={done ? "/sign-in" : "/forgot-password"} className="link">
        {done ? t("signIn") : t("forgotTitle")}
      </Link>
    </div>
  );
}
