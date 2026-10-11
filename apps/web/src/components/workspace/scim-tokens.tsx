"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { createScimTokenAction, revokeScimTokenAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { useConfirm } from "./confirm";

export interface ScimTokenView {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

/** SCIM provisioning: the address to give the company directory, and its tokens */
export function ScimTokens({ slug, baseUrl, tokens }: { slug: string; baseUrl: string; tokens: ScimTokenView[] }) {
  const t = useTranslations("security.scim");
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" });
  return (
    <section className="stack" aria-labelledby="scim-title">
      {confirmDialog}
      <div>
        <h2 id="scim-title" style={{ margin: 0 }}>
          {t("title")}
        </h2>
        <p className="hint">{t("intro")}</p>
      </div>
      <div className="panel stack">
        <FormAlert>{error}</FormAlert>
        <dl className="dns-record">
          <dt>{t("baseUrl")}</dt>
          <dd>
            <code>{baseUrl}</code>
          </dd>
          <dt>{t("auth")}</dt>
          <dd>{t("authValue")}</dd>
        </dl>
        {fresh && (
          <div className="note-box" role="status">
            <p style={{ margin: "0 0 6px" }}>{t("copyNow")}</p>
            <code className="secret-once">{fresh}</code>
          </div>
        )}
        {tokens.length > 0 && (
          <ul className="choice-list">
            {tokens.map((tk) => (
              <li key={tk.id}>
                <span>
                  <strong>{tk.name}</strong> <code className="hint">{tk.prefix}…</code>
                </span>
                <span className="hint">{tk.lastUsedAt ? t("lastUsed", { date: day(tk.lastUsedAt) }) : t("neverUsed")}</span>
                <button
                  type="button"
                  className="btn sm danger"
                  onClick={async () => {
                    if (!(await confirm({ message: t("revokeConfirm", { name: tk.name }), confirmLabel: t("revoke"), danger: true })))
                      return;
                    const res = await revokeScimTokenAction(slug, tk.id);
                    if (!res.ok) return setError(res.error);
                    router.refresh();
                  }}
                >
                  {t("revoke")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="controls"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await createScimTokenAction(slug, name);
            if (!res.ok) return setError(res.error);
            setError(null);
            setName("");
            setFresh(res.data.token);
            router.refresh();
          }}
        >
          <label htmlFor="scimName" className="sr-only">
            {t("name")}
          </label>
          <input
            id="scimName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            style={{ maxWidth: 280 }}
          />
          <button type="submit" className="btn">
            {t("create")}
          </button>
        </form>
      </div>
    </section>
  );
}
