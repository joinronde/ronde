"use client";

import { localeNames, locales } from "@ronde/i18n";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { saveInstanceSettingsAction } from "@/app/admin/actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { Select } from "@/components/select";
import { Icon } from "@/components/shell/icons";
import type { InstanceSettings } from "@/lib/server/instance";
import { type LicenseInfo, LicensePanel } from "./license-panel";

/** The sign-up policies, from the most closed to the most open */
const POLICIES = [
  { id: "invite-only", icon: "lock" },
  { id: "domains", icon: "mail" },
  { id: "open", icon: "globe" },
] as const;

export function InstanceAdminView({
  settings,
  counts,
  license,
}: {
  settings: InstanceSettings;
  counts: { users: number; workspaces: number; meetings: number };
  license: LicenseInfo;
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [values, setValues] = useState({ ...settings, signupDomains: settings.signupDomains.join(", ") });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<typeof values>) => {
    setSaved(false);
    setValues((v) => ({ ...v, ...patch }));
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await saveInstanceSettingsAction(values);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setSaved(true);
    router.refresh();
  };
  return (
    <div className="page narrow settings-page">
      <header className="page-head">
        <h1>{t("title")}</h1>
        <p className="muted">{t("intro")}</p>
      </header>
      <dl className="admin-counts">
        <div>
          <dt>{t("counts.users")}</dt>
          <dd>{counts.users}</dd>
        </div>
        <div>
          <dt>{t("counts.workspaces")}</dt>
          <dd>{counts.workspaces}</dd>
        </div>
        <div>
          <dt>{t("counts.meetings")}</dt>
          <dd>{counts.meetings}</dd>
        </div>
      </dl>
      <FormAlert>{error}</FormAlert>
      <form className="panel form" onSubmit={save}>
        <h2 style={{ margin: 0 }}>{t("language")}</h2>
        <Field label={t("defaultLocale")} hint={t("defaultLocaleHint")}>
          {(p) => (
            <Select
              {...p}
              value={values.defaultLocale}
              onChange={(e) => set({ defaultLocale: e.target.value as typeof values.defaultLocale })}
            >
              {locales.map((l) => (
                <option key={l} value={l}>
                  {localeNames[l]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset className="plain">
          <legend>
            <h2 style={{ margin: 0 }}>{t("signup")}</h2>
          </legend>
          <div className="policy-cards">
            {POLICIES.map(({ id, icon }) => (
              <div key={id} className="policy-card">
                <label className="policy-pick">
                  <span className="policy-icon" aria-hidden="true">
                    <Icon name={icon} size={18} />
                  </span>
                  <span className="policy-text">
                    <span className="policy-title">
                      {t(`policies.${id}.label`)}
                      {id === "invite-only" && <span className="pill view">{t("recommended")}</span>}
                    </span>
                    <span className="hint">{t(`policies.${id}.hint`)}</span>
                  </span>
                  <input
                    type="radio"
                    name="policy"
                    value={id}
                    checked={values.signupPolicy === id}
                    onChange={() => set({ signupPolicy: id })}
                  />
                </label>
                {/* The domains belong to their policy: asked for inside its card, once it is picked */}
                {id === "domains" && values.signupPolicy === "domains" && (
                  <div className="policy-extra">
                    <Field label={t("domains")} hint={t("domainsHint")}>
                      {(p) => (
                        <input
                          {...p}
                          type="text"
                          dir="ltr"
                          required
                          placeholder="example.org, example.com"
                          value={values.signupDomains}
                          onChange={(e) => set({ signupDomains: e.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                )}
              </div>
            ))}
          </div>
        </fieldset>
        <div className="form-foot">
          <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
            {t("save")}
          </button>
          <span className="hint" role="status">
            {saved ? `✓ ${t("saved")}` : ""}
          </span>
        </div>
      </form>
      <LicensePanel info={license} />
    </div>
  );
}
