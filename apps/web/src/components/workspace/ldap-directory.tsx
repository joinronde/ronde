"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { type LdapInput, removeLdapAction, saveLdapAction, testLdapAction } from "@/app/w/[ws]/actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { useConfirm } from "./confirm";

export type LdapView = Omit<LdapInput, "bindPassword"> & { passwordSet: boolean };

const DEFAULTS: LdapView = {
  url: "",
  startTls: false,
  bindDn: "",
  baseDn: "",
  userFilter: "(&(objectClass=person)(mail={{email}}))",
  emailAttribute: "mail",
  nameAttribute: "cn",
  enabled: true,
  passwordSet: false,
};

/** Company directory (LDAP, Active Directory): people of the verified domains sign in with its password */
export function LdapDirectory({ slug, directory }: { slug: string; directory: LdapView | null }) {
  const t = useTranslations("security.ldap");
  const router = useRouter();
  const [values, setValues] = useState<LdapView>(directory ?? DEFAULTS);
  const [password, setPassword] = useState<string | null>(null);
  const [sample, setSample] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const set = (patch: Partial<LdapView>) => setValues((v) => ({ ...v, ...patch }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { passwordSet: _p, ...rest } = values;
    const res = await saveLdapAction(slug, { ...rest, bindPassword: password });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setPassword(null);
    setResult(t("saved"));
    router.refresh();
  };
  const test = async () => {
    setBusy(true);
    const res = await testLdapAction(slug, sample);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setResult(res.data.ok ? t("found", { count: res.data.found }) : t("testFailed", { error: res.data.error }));
  };

  return (
    <section className="stack" aria-labelledby="ldap-title">
      {confirmDialog}
      <div>
        <h2 id="ldap-title" style={{ margin: 0 }}>
          {t("title")}
        </h2>
        <p className="hint">{t("intro")}</p>
      </div>
      <form className="panel form" onSubmit={save}>
        <FormAlert>{error}</FormAlert>
        <div className="grid2">
          <Field label={t("url")} hint={t("urlHint")}>
            {(p) => (
              <input
                {...p}
                required
                value={values.url}
                onChange={(e) => set({ url: e.target.value })}
                placeholder="ldaps://ldap.acme.com:636"
              />
            )}
          </Field>
          <label className="check" style={{ alignSelf: "end" }}>
            <input type="checkbox" checked={values.startTls} onChange={(e) => set({ startTls: e.target.checked })} /> {t("startTls")}
          </label>
        </div>
        <div className="grid2">
          <Field label={t("bindDn")}>
            {(p) => (
              <input
                {...p}
                required
                value={values.bindDn}
                onChange={(e) => set({ bindDn: e.target.value })}
                placeholder="cn=ronde,ou=services,dc=acme,dc=com"
              />
            )}
          </Field>
          <Field label={t("bindPassword")} hint={values.passwordSet && password === null ? t("passwordKept") : undefined}>
            {(p) => (
              <input
                {...p}
                type="password"
                autoComplete="off"
                value={password ?? ""}
                placeholder={values.passwordSet ? "••••••••" : ""}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t("baseDn")}>
          {(p) => (
            <input
              {...p}
              required
              value={values.baseDn}
              onChange={(e) => set({ baseDn: e.target.value })}
              placeholder="ou=people,dc=acme,dc=com"
            />
          )}
        </Field>
        <Field label={t("userFilter")} hint={t("userFilterHint")}>
          {(p) => <input {...p} required value={values.userFilter} onChange={(e) => set({ userFilter: e.target.value })} />}
        </Field>
        <div className="grid2">
          <Field label={t("emailAttribute")}>
            {(p) => <input {...p} value={values.emailAttribute} onChange={(e) => set({ emailAttribute: e.target.value })} />}
          </Field>
          <Field label={t("nameAttribute")}>
            {(p) => <input {...p} value={values.nameAttribute} onChange={(e) => set({ nameAttribute: e.target.value })} />}
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={values.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> {t("enabled")}
        </label>
        <div className="form-foot">
          <button type="submit" className="btn primary" disabled={busy}>
            {t("save")}
          </button>
          {directory && (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                if (!(await confirm({ message: t("removeConfirm"), confirmLabel: t("remove"), danger: true }))) return;
                const res = await removeLdapAction(slug);
                if (!res.ok) return setError(res.error);
                setValues(DEFAULTS);
                router.refresh();
              }}
            >
              {t("remove")}
            </button>
          )}
        </div>
      </form>
      {directory && (
        <div className="controls">
          <label htmlFor="ldapSample" className="sr-only">
            {t("sample")}
          </label>
          <input
            id="ldapSample"
            type="email"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder={t("sample")}
            style={{ maxWidth: 320 }}
          />
          <button type="button" className="btn" disabled={busy || !sample.trim()} onClick={test}>
            {t("test")}
          </button>
        </div>
      )}
      {result && (
        <p className="hint" role="status">
          {result}
        </p>
      )}
    </section>
  );
}
