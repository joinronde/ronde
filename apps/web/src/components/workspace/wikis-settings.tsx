"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteWikiAction, saveWikiAction, testWikiAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { Select } from "@/components/select";
import type { WikiView } from "@/lib/server/wikis";
import { track } from "@/lib/shared/track";
import { NewTab } from "../shell/new-tab";
import type { useConfirm } from "./confirm";

type ConfirmFn = ReturnType<typeof useConfirm>[1];

type Kind = WikiView["kind"];
type Key = "parent" | "site" | "space" | "email";

/** Fields each wiki asks for, with an example; the optional ones say so */
const FIELDS: Record<Kind, { key: Key; placeholder: string; optional?: true }[]> = {
  notion: [{ key: "parent", placeholder: "https://www.notion.so/acme/Team-meetings-1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6" }],
  confluence: [
    { key: "site", placeholder: "https://acme.atlassian.net" },
    { key: "space", placeholder: "ENG" },
    { key: "parent", placeholder: "https://acme.atlassian.net/wiki/spaces/ENG/pages/123456", optional: true },
    { key: "email", placeholder: "bot@acme.com", optional: true },
  ],
};

/** Where a wiki puts the pages, in a few words */
const whereOf = (w: WikiView) => {
  if (w.kind === "notion") return "Notion";
  try {
    return `${w.config.space} · ${new URL(w.config.site ?? "").host}`;
  } catch {
    return w.config.space ?? "";
  }
};

export interface WikisSettingsProps {
  slug: string;
  wikis: WikiView[];
  available: boolean;
  plansUrl: string | null;
}

/** Wikis of the workspace, where meetings publish their minutes (Team) */
export function WikisSettings({ slug, wikis, available, plansUrl, confirm }: WikisSettingsProps & { confirm: ConfirmFn }) {
  const t = useTranslations("wikis");
  const tm = useTranslations("modules");
  const tf = useTranslations("features");
  const router = useRouter();
  const [editing, setEditing] = useState<WikiView | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});

  if (!available)
    return (
      <section className="panel" aria-labelledby="wikis-title">
        <h2 id="wikis-title">{t("title")}</h2>
        <div className="logo-locked">
          <p className="muted">{tm("upgrade.comesWith", { feature: tf("integrations.wikis"), edition: tm("editions.team") })}</p>
          {plansUrl && (
            <a
              data-umami-event="upgrade_click"
              data-umami-event-from="wikis-settings"
              className="link"
              href={plansUrl}
              target="_blank"
              rel="noopener"
            >
              {tm("upgrade.plans")}
              <NewTab />
            </a>
          )}
        </div>
      </section>
    );

  return (
    <section className="panel trackers" aria-labelledby="wikis-title">
      <h2 id="wikis-title">{t("title")}</h2>
      <p className="muted">{t("intro")}</p>
      <FormAlert>{error}</FormAlert>
      {wikis.length ? (
        <ul className="tracker-list">
          {wikis.map((w) => (
            <li key={w.id}>
              <span className={`tracker-badge ${w.kind}`}>{t(`kinds.${w.kind}`)}</span>
              <span className="tracker-text">
                <strong>{w.name}</strong>
                <span className="hint">{whereOf(w)}</span>
              </span>
              <span className="hint" role="status">
                {status[w.id]}
              </span>
              <button
                type="button"
                className="btn sm"
                onClick={async () => {
                  setStatus((s) => ({ ...s, [w.id]: "…" }));
                  const res = await testWikiAction(slug, w.id);
                  setStatus((s) => ({ ...s, [w.id]: res.ok ? t("works") : "" }));
                  setError(res.ok ? null : res.error);
                }}
              >
                {t("test")}
              </button>
              <button type="button" className="btn sm" onClick={() => setEditing(w)}>
                {t("edit")}
              </button>
              <button
                type="button"
                className="btn sm danger"
                onClick={async () => {
                  if (!(await confirm({ message: t("removeConfirm", { name: w.name }), confirmLabel: t("remove"), danger: true }))) return;
                  const res = await deleteWikiAction(slug, w.id);
                  if (!res.ok) return setError(res.error);
                  router.refresh();
                }}
              >
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="emptybox">{t("empty")}</div>
      )}
      {editing ? (
        <WikiForm
          slug={slug}
          wiki={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
          onError={setError}
        />
      ) : (
        <div>
          <button type="button" className="btn" onClick={() => setEditing("new")}>
            {t("add")}
          </button>
        </div>
      )}
    </section>
  );
}

function WikiForm({
  slug,
  wiki,
  onDone,
  onError,
}: {
  slug: string;
  wiki: WikiView | null;
  onDone: () => void;
  onError: (e: string | null) => void;
}) {
  const t = useTranslations("wikis");
  const [kind, setKind] = useState<Kind>(wiki?.kind ?? "notion");
  const [name, setName] = useState(wiki?.name ?? "");
  const [config, setConfig] = useState<Record<string, string>>(wiki?.config ?? {});
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form tracker-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const res = await saveWikiAction(slug, {
          ...(wiki ? { id: wiki.id } : {}),
          kind,
          name: name || t(`kinds.${kind}`),
          config: Object.fromEntries(FIELDS[kind].map((f) => [f.key, (config[f.key] ?? "").trim()])),
          token,
        });
        setBusy(false);
        if (!res.ok) return onError(res.error);
        if (!wiki) track("integration_connected", { kind: `wiki-${kind}` });
        onError(null);
        onDone();
      }}
    >
      <div className="grid2">
        <div className="field">
          <label htmlFor="wkKind">{t("kind")}</label>
          <Select id="wkKind" value={kind} disabled={!!wiki} onChange={(e) => setKind(e.target.value as Kind)}>
            {(["notion", "confluence"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="field">
          <label htmlFor="wkName">{t("name")}</label>
          <input id="wkName" value={name} maxLength={60} placeholder={t(`kinds.${kind}`)} onChange={(e) => setName(e.target.value)} />
        </div>
        {FIELDS[kind].map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`wk-${f.key}`}>
              {t(`fields.${kind}.${f.key}` as "fields.notion.parent")}
              {f.optional && <span className="hint"> · {t("optional")}</span>}
            </label>
            <input
              id={`wk-${f.key}`}
              required={!f.optional}
              dir="ltr"
              value={config[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="field">
          <label htmlFor="wkToken">{t(`token.${kind}`)}</label>
          <input
            id="wkToken"
            type="password"
            autoComplete="off"
            required={!wiki}
            value={token}
            placeholder={wiki ? "••••" : ""}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
      </div>
      <p className="hint">{wiki ? t("tokenKept") : t(`hints.${kind}`)}</p>
      <div className="form-foot">
        <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
          {t("save")}
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
