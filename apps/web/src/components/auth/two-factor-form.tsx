"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { authClient, failureKey, safeNext } from "@/lib/auth-client";
import { Field, FormAlert } from "./fields";

type FailureKey = ReturnType<typeof failureKey>;

export function TwoFactorForm({ next: rawNext }: { next?: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FailureKey | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice: trust })
      : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ""), trustDevice: trust });
    if (error) {
      setBusy(false);
      setError(failureKey(error));
      return;
    }
    router.replace(safeNext(rawNext));
    router.refresh();
  };
  return (
    <div className="auth-body">
      <h1>{t("twoFactorTitle")}</h1>
      <p className="muted">{backup ? t("backupIntro") : t("twoFactorIntro")}</p>
      <FormAlert>{error && t(`failure.${error}`)}</FormAlert>
      <form className="auth-form" onSubmit={submit}>
        <Field label={backup ? t("backupCode") : t("code")}>
          {(p) => (
            <input
              {...p}
              type="text"
              className="code-input"
              autoComplete="one-time-code"
              inputMode={backup ? "text" : "numeric"}
              pattern={backup ? undefined : "[0-9 ]{6,7}"}
              maxLength={backup ? 32 : 7}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
        <label className="check">
          <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
          {t("trustDevice")}
        </label>
        <button type="submit" className="btn primary big" disabled={busy} aria-busy={busy}>
          {t("verify")}
        </button>
      </form>
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          setBackup(!backup);
          setCode("");
          setError(null);
        }}
      >
        {backup ? t("useAuthenticator") : t("useBackupCode")}
      </button>
    </div>
  );
}
