"use client";

import type { SsoProviderView } from "@ronde/editions/ee";
import { Modal } from "@ronde/ui/modal";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { addSsoProviderAction, removeSsoProviderAction } from "@/app/w/[ws]/actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { useConfirm } from "./confirm";

export type ProviderRow = SsoProviderView & { callback: string; metadata: string | null };

type Draft = {
  kind: "oidc" | "saml";
  name: string;
  domains: string[];
  issuer: string;
  clientId: string;
  clientSecret: string;
  entryPoint: string;
  idpEntityId: string;
  certificate: string;
};

const EMPTY: Draft = {
  kind: "oidc",
  name: "",
  domains: [],
  issuer: "",
  clientId: "",
  clientSecret: "",
  entryPoint: "",
  idpEntityId: "",
  certificate: "",
};

/** Identity providers of the workspace: OIDC or SAML, each for some of its verified domains */
export function SsoProviders({ slug, providers, verifiedDomains }: { slug: string; providers: ProviderRow[]; verifiedDomains: string[] }) {
  const t = useTranslations("security.sso");
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const set = (patch: Partial<Draft>) => setDraft((d) => d && { ...d, ...patch });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    const res = await addSsoProviderAction(slug, {
      name: draft.name,
      domains: draft.domains,
      ...(draft.kind === "oidc"
        ? { oidc: { issuer: draft.issuer, clientId: draft.clientId, clientSecret: draft.clientSecret } }
        : { saml: { entryPoint: draft.entryPoint, idpEntityId: draft.idpEntityId, certificate: draft.certificate } }),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setDraft(null);
    router.refresh();
  };

  return (
    <section className="stack" aria-labelledby="sso-title">
      {confirmDialog}
      <div className="page-head row">
        <div>
          <h2 id="sso-title" style={{ margin: 0 }}>
            {t("title")}
          </h2>
          <p className="hint">{t("intro")}</p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={!verifiedDomains.length}
          onClick={() => setDraft({ ...EMPTY, domains: verifiedDomains.slice(0, 1) })}
        >
          + {t("add")}
        </button>
      </div>
      {!verifiedDomains.length && <p className="note-box">{t("verifyFirst")}</p>}
      {!draft && <FormAlert>{error}</FormAlert>}
      {providers.length > 0 && (
        <ul className="domain-list">
          {providers.map((p) => (
            <li key={p.id} className="panel">
              <div className="role-head">
                <strong>{p.name || p.issuer}</strong>
                <span className="st-pill st-open">{p.kind.toUpperCase()}</span>
              </div>
              <p className="hint">{t("forDomains", { domains: p.domains.map((d) => `@${d}`).join(", ") })}</p>
              <dl className="dns-record">
                <dt>{p.kind === "saml" ? t("acs") : t("redirect")}</dt>
                <dd>
                  <code>{p.callback}</code>
                </dd>
                {p.metadata && (
                  <>
                    <dt>{t("entityId")}</dt>
                    <dd>
                      <code>{p.metadata}</code>
                    </dd>
                  </>
                )}
              </dl>
              <div>
                <button
                  type="button"
                  className="btn sm danger"
                  onClick={async () => {
                    if (
                      !(await confirm({
                        message: t("removeConfirm", { name: p.name || p.issuer }),
                        confirmLabel: t("remove"),
                        danger: true,
                      }))
                    )
                      return;
                    const res = await removeSsoProviderAction(slug, p.id);
                    if (!res.ok) return setError(res.error);
                    router.refresh();
                  }}
                >
                  {t("remove")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {draft && (
        <Modal onClose={() => setDraft(null)} labelledBy="ssoTitle">
          <form className="form role-form" onSubmit={save}>
            <h2 id="ssoTitle" style={{ margin: 0 }}>
              {t("newTitle")}
            </h2>
            <FormAlert>{error}</FormAlert>
            <div className="seg" role="group" aria-label={t("protocol")}>
              {(["oidc", "saml"] as const).map((k) => (
                <button key={k} type="button" aria-pressed={draft.kind === k} onClick={() => set({ kind: k })}>
                  {k === "oidc" ? "OpenID Connect" : "SAML 2.0"}
                </button>
              ))}
            </div>
            <Field label={t("name")} hint={t("nameHint")}>
              {(p) => (
                <input
                  {...p}
                  required
                  maxLength={60}
                  value={draft.name}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder="Acme Okta"
                />
              )}
            </Field>
            <fieldset className="plain stack">
              <legend className="lbl-s">{t("domains")}</legend>
              {verifiedDomains.map((d) => (
                <label key={d} className="check">
                  <input
                    type="checkbox"
                    checked={draft.domains.includes(d)}
                    onChange={(e) => set({ domains: e.target.checked ? [...draft.domains, d] : draft.domains.filter((x) => x !== d) })}
                  />{" "}
                  @{d}
                </label>
              ))}
            </fieldset>
            {draft.kind === "oidc" ? (
              <>
                <Field label={t("issuer")} hint={t("issuerHint")}>
                  {(p) => (
                    <input
                      {...p}
                      type="url"
                      required
                      value={draft.issuer}
                      onChange={(e) => set({ issuer: e.target.value })}
                      placeholder="https://acme.okta.com"
                    />
                  )}
                </Field>
                <Field label={t("clientId")}>
                  {(p) => <input {...p} required value={draft.clientId} onChange={(e) => set({ clientId: e.target.value })} />}
                </Field>
                <Field label={t("clientSecret")}>
                  {(p) => (
                    <input
                      {...p}
                      type="password"
                      required
                      autoComplete="off"
                      value={draft.clientSecret}
                      onChange={(e) => set({ clientSecret: e.target.value })}
                    />
                  )}
                </Field>
              </>
            ) : (
              <>
                <Field label={t("entryPoint")}>
                  {(p) => (
                    <input
                      {...p}
                      type="url"
                      required
                      value={draft.entryPoint}
                      onChange={(e) => set({ entryPoint: e.target.value })}
                      placeholder="https://idp.acme.com/sso/saml"
                    />
                  )}
                </Field>
                <Field label={t("idpEntityId")}>
                  {(p) => (
                    <input
                      {...p}
                      required
                      value={draft.idpEntityId}
                      onChange={(e) => set({ idpEntityId: e.target.value })}
                      placeholder="http://www.okta.com/exk…"
                    />
                  )}
                </Field>
                <Field label={t("certificate")} hint={t("certificateHint")}>
                  {(p) => (
                    <textarea
                      {...p}
                      required
                      rows={5}
                      spellCheck={false}
                      value={draft.certificate}
                      onChange={(e) => set({ certificate: e.target.value })}
                      placeholder="-----BEGIN CERTIFICATE-----"
                    />
                  )}
                </Field>
              </>
            )}
            <p className="hint">{t("afterSave")}</p>
            <div className="form-foot">
              <button type="submit" className="btn primary" disabled={busy || !draft.domains.length} aria-busy={busy}>
                {t("save")}
              </button>
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                {t("cancel")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
