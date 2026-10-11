"use client";

import type { DomainView } from "@ronde/editions/ee";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { addDomainAction, removeDomainAction, updateDomainAction, verifyDomainAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { useConfirm } from "./confirm";
import { LdapDirectory, type LdapView } from "./ldap-directory";
import { ScimTokens, type ScimTokenView } from "./scim-tokens";
import { type ProviderRow, SsoProviders } from "./sso-providers";

interface Props {
  slug: string;
  domains: DomainView[];
  /** Requiring SSO is part of the license */
  enforcement: boolean;
  /** Name of the single sign-on provider of the instance; null when none is set up */
  ssoProvider: string | null;
  /** Identity providers of the workspace; null when the license has none */
  providers: ProviderRow[] | null;
  /** Company directory: undefined when the license has none, null when not set up */
  ldap?: LdapView | null;
  /** SCIM provisioning: undefined when the license has none */
  scim?: { baseUrl: string; tokens: ScimTokenView[] };
}

/** Email domains of the workspace: verified by DNS, then capturing new accounts and requiring single sign-on */
export function SecurityView({ slug, domains, enforcement, ssoProvider, providers, ldap, scim }: Props) {
  const t = useTranslations("security");
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const act = async (key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setError(null);
    router.refresh();
  };
  return (
    <div className="stack security">
      {confirmDialog}
      <p className="muted">{t("intro")}</p>
      <FormAlert>{error}</FormAlert>
      <form
        className="controls"
        onSubmit={async (e) => {
          e.preventDefault();
          await act("add", () => addDomainAction(slug, domain));
          setDomain("");
        }}
      >
        <label htmlFor="newDomain" className="sr-only">
          {t("domain")}
        </label>
        <input
          id="newDomain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="acme.com"
          style={{ flex: 1, maxWidth: 320 }}
        />
        <button type="submit" className="btn primary" disabled={!domain.trim() || busy === "add"}>
          {t("add")}
        </button>
      </form>
      {domains.length ? (
        <ul className="domain-list">
          {domains.map((d) => (
            <li key={d.id} className="panel">
              <div className="role-head">
                <strong>{d.domain}</strong>
                <span className={`st-pill ${d.verified ? "st-done" : "st-doing"}`}>{d.verified ? t("verified") : t("pending")}</span>
              </div>
              {d.verified ? (
                <div className="stack">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={d.capture}
                      disabled={busy === d.id}
                      onChange={(e) => act(d.id, () => updateDomainAction(slug, d.id, { capture: e.target.checked }))}
                    />{" "}
                    <span>
                      <strong>{t("capture")}</strong> <span className="hint">{t("captureHint", { domain: d.domain })}</span>
                    </span>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={d.enforceSso}
                      disabled={busy === d.id || !enforcement || (!ssoProvider && !d.enforceSso)}
                      onChange={async (e) => {
                        const on = e.target.checked;
                        if (
                          on &&
                          !(await confirm({
                            message: t("enforceConfirm", { domain: d.domain, provider: ssoProvider ?? "" }),
                            confirmLabel: t("enforceYes"),
                          }))
                        )
                          return;
                        await act(d.id, () => updateDomainAction(slug, d.id, { enforceSso: on }));
                      }}
                    />{" "}
                    <span>
                      <strong>{t("enforce")}</strong>{" "}
                      <span className="hint">
                        {ssoProvider ? t("enforceHint", { domain: d.domain, provider: ssoProvider }) : t("noProvider")}
                      </span>
                    </span>
                  </label>
                </div>
              ) : (
                <div className="stack">
                  <p className="hint">{t("addRecord")}</p>
                  <dl className="dns-record">
                    <dt>{t("recordType")}</dt>
                    <dd>
                      <code>TXT</code>
                    </dd>
                    <dt>{t("recordName")}</dt>
                    <dd>
                      <code>{d.record.name}</code>
                    </dd>
                    <dt>{t("recordValue")}</dt>
                    <dd>
                      <code>{d.record.value}</code>
                    </dd>
                  </dl>
                  <div>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy === d.id}
                      onClick={() => act(d.id, () => verifyDomainAction(slug, d.id))}
                    >
                      {t("verify")}
                    </button>
                  </div>
                </div>
              )}
              <div>
                <button
                  type="button"
                  className="btn sm danger"
                  onClick={async () => {
                    if (await confirm({ message: t("removeConfirm", { domain: d.domain }), confirmLabel: t("remove"), danger: true }))
                      await act(d.id, () => removeDomainAction(slug, d.id));
                  }}
                >
                  {t("remove")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="emptybox">{t("empty")}</div>
      )}
      {ldap !== undefined && <LdapDirectory slug={slug} directory={ldap} />}
      {providers && (
        <SsoProviders slug={slug} providers={providers} verifiedDomains={domains.filter((d) => d.verified).map((d) => d.domain)} />
      )}
      {scim && <ScimTokens slug={slug} baseUrl={scim.baseUrl} tokens={scim.tokens} />}
    </div>
  );
}
