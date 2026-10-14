"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteVideoAccountAction, saveVideoAccountAction, testVideoAccountAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { Select } from "@/components/select";
import type { VideoAccountView } from "@/lib/server/video-accounts";
import { track } from "@/lib/shared/track";
import { NewTab } from "../shell/new-tab";
import type { useConfirm } from "./confirm";

type ConfirmFn = ReturnType<typeof useConfirm>[1];

type Kind = VideoAccountView["kind"];

/** Fields each provider asks for, with an example */
const FIELDS: Record<
  Kind,
  { key: "accountId" | "clientId" | "clientEmail" | "subject" | "tenant" | "organizer" | "url"; placeholder: string }[]
> = {
  bbb: [{ key: "url", placeholder: "https://bbb.example.com/bigbluebutton" }],
  zoom: [
    { key: "accountId", placeholder: "a1B2c3D4e5" },
    { key: "clientId", placeholder: "xYz123AbC" },
  ],
  meet: [
    { key: "clientEmail", placeholder: "ronde@acme.iam.gserviceaccount.com" },
    { key: "subject", placeholder: "rooms@acme.com" },
  ],
  teams: [
    { key: "tenant", placeholder: "acme.onmicrosoft.com" },
    { key: "clientId", placeholder: "00000000-0000-0000-0000-000000000000" },
    { key: "organizer", placeholder: "rooms@acme.com" },
  ],
};

export interface VideoAccountsSettingsProps {
  slug: string;
  accounts: VideoAccountView[];
  /** Zoom, Meet and Teams are in the plan (BigBlueButton servers are in every edition) */
  available: boolean;
  plansUrl: string | null;
}

/** Video accounts of the workspace, which create the lasting rooms of its meetings (Team) */
export function VideoAccountsSettings({
  slug,
  accounts,
  available,
  plansUrl,
  confirm,
}: VideoAccountsSettingsProps & { confirm: ConfirmFn }) {
  const t = useTranslations("videoAccounts");
  const tm = useTranslations("modules");
  const tf = useTranslations("features");
  const router = useRouter();
  const [editing, setEditing] = useState<VideoAccountView | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});

  return (
    <section className="panel video-accounts" aria-labelledby="video-title">
      <h2 id="video-title">{t("title")}</h2>
      <p className="muted">{t("intro")}</p>
      {!available && (
        <div className="logo-locked">
          <p className="muted">{tm("upgrade.comesWith", { feature: tf("integrations.videoLinks"), edition: tm("editions.team") })}</p>
          {plansUrl && (
            <a
              data-umami-event="upgrade_click"
              data-umami-event-from="video-accounts-settings"
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
      )}
      <FormAlert>{error}</FormAlert>
      {accounts.length ? (
        <ul className="tracker-list">
          {accounts.map((tr) => (
            <li key={tr.id}>
              <span className={`tracker-badge ${tr.kind}`}>{t(`kinds.${tr.kind}`)}</span>
              <span className="tracker-text">
                <strong>{tr.name}</strong>
                <span className="hint">{tr.config.url ?? tr.config.subject ?? tr.config.organizer ?? tr.config.accountId}</span>
              </span>
              <span className="hint" role="status">
                {status[tr.id]}
              </span>
              <button
                type="button"
                className="btn sm"
                onClick={async () => {
                  setStatus((s) => ({ ...s, [tr.id]: "…" }));
                  const res = await testVideoAccountAction(slug, tr.id);
                  setStatus((s) => ({ ...s, [tr.id]: res.ok ? t("works") : "" }));
                  setError(res.ok ? null : res.error);
                }}
              >
                {t("test")}
              </button>
              <button type="button" className="btn sm" onClick={() => setEditing(tr)}>
                {t("edit")}
              </button>
              <button
                type="button"
                className="btn sm danger"
                onClick={async () => {
                  if (!(await confirm({ message: t("removeConfirm", { name: tr.name }), confirmLabel: t("remove"), danger: true }))) return;
                  const res = await deleteVideoAccountAction(slug, tr.id);
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
        <AccountForm
          slug={slug}
          account={editing === "new" ? null : editing}
          kinds={available ? KINDS : ["bbb"]}
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
      <p className="hint">
        {t("useItBbb")}
        {available && ` ${t("useIt")}`}
      </p>
    </section>
  );
}

const KINDS = ["zoom", "meet", "teams", "bbb"] as const;

function AccountForm({
  slug,
  account: tracker,
  kinds,
  onDone,
  onError,
}: {
  slug: string;
  account: VideoAccountView | null;
  kinds: readonly Kind[];
  onDone: () => void;
  onError: (e: string | null) => void;
}) {
  const t = useTranslations("videoAccounts");
  const [kind, setKind] = useState<Kind>(tracker?.kind ?? kinds[0]!);
  const [name, setName] = useState(tracker?.name ?? "");
  const [config, setConfig] = useState<Record<string, string>>(tracker?.config ?? {});
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form tracker-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const res = await saveVideoAccountAction(slug, {
          ...(tracker ? { id: tracker.id } : {}),
          kind,
          name: name || t(`kinds.${kind}`),
          config: Object.fromEntries(FIELDS[kind].map((f) => [f.key, (config[f.key] ?? "").trim()])),
          secret: token,
        });
        setBusy(false);
        if (!res.ok) return onError(res.error);
        if (!tracker) track("integration_connected", { kind: "video-" + kind });
        onError(null);
        onDone();
      }}
    >
      <div className="grid2">
        <div className="field">
          <label htmlFor="trKind">{t("kind")}</label>
          <Select id="trKind" value={kind} disabled={!!tracker} onChange={(e) => setKind(e.target.value as Kind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="field">
          <label htmlFor="trName">{t("name")}</label>
          <input id="trName" value={name} maxLength={60} placeholder={t(`kinds.${kind}`)} onChange={(e) => setName(e.target.value)} />
        </div>
        {FIELDS[kind].map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`tr-${f.key}`}>{t(`fields.${f.key}`)}</label>
            <input
              id={`tr-${f.key}`}
              required
              value={config[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="field">
          <label htmlFor="trToken">{t(`secret.${kind}`)}</label>
          {kind === "meet" ? (
            <textarea
              id="trToken"
              rows={3}
              required={!tracker}
              value={token}
              placeholder={tracker ? "••••" : "-----BEGIN PRIVATE KEY-----"}
              onChange={(e) => setToken(e.target.value)}
            />
          ) : (
            <input
              id="trToken"
              type="password"
              autoComplete="off"
              required={!tracker}
              value={token}
              placeholder={tracker ? "••••" : ""}
              onChange={(e) => setToken(e.target.value)}
            />
          )}
        </div>
      </div>
      <p className="hint">{tracker ? t("tokenKept") : t(`hints.${kind}`)}</p>
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
