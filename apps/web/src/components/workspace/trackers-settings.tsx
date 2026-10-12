"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteTrackerAction, saveTrackerAction, testTrackerAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { Select } from "@/components/select";
import type { TrackerView } from "@/lib/server/trackers";
import { track } from "@/lib/shared/track";
import { NewTab } from "../shell/new-tab";
import type { useConfirm } from "./confirm";

type ConfirmFn = ReturnType<typeof useConfirm>[1];

type Kind = TrackerView["kind"];

/** Fields each tool asks for, with an example */
const FIELDS: Record<Kind, { key: "site" | "project" | "email" | "team" | "url" | "repo"; placeholder: string }[]> = {
  jira: [
    { key: "site", placeholder: "https://acme.atlassian.net" },
    { key: "project", placeholder: "OPS" },
    { key: "email", placeholder: "bot@acme.com" },
  ],
  linear: [{ key: "team", placeholder: "ENG" }],
  gitlab: [
    { key: "url", placeholder: "https://gitlab.com" },
    { key: "project", placeholder: "acme/app" },
  ],
  github: [{ key: "repo", placeholder: "acme/app" }],
};

export interface TrackersSettingsProps {
  slug: string;
  trackers: TrackerView[];
  available: boolean;
  plansUrl: string | null;
}

/** Issue trackers of the workspace, where follow-up actions become tickets (Team) */
export function TrackersSettings({ slug, trackers, available, plansUrl, confirm }: TrackersSettingsProps & { confirm: ConfirmFn }) {
  const t = useTranslations("trackers");
  const tm = useTranslations("modules");
  const tf = useTranslations("features");
  const router = useRouter();
  const [editing, setEditing] = useState<TrackerView | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});

  if (!available)
    return (
      <section id="trackers" className="panel" aria-labelledby="trackers-title">
        <h2 id="trackers-title">{t("title")}</h2>
        <div className="logo-locked">
          <p className="muted">{tm("upgrade.comesWith", { feature: tf("integrations.writeBack"), edition: tm("editions.team") })}</p>
          {plansUrl && (
            <a
              data-umami-event="upgrade_click"
              data-umami-event-from="trackers-settings"
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
    <section id="trackers" className="panel trackers" aria-labelledby="trackers-title">
      <h2 id="trackers-title">{t("title")}</h2>
      <p className="muted">{t("intro")}</p>
      <FormAlert>{error}</FormAlert>
      {trackers.length ? (
        <ul className="tracker-list">
          {trackers.map((tr) => (
            <li key={tr.id}>
              <span className={`tracker-badge ${tr.kind}`}>{t(`kinds.${tr.kind}`)}</span>
              <span className="tracker-text">
                <strong>{tr.name}</strong>
                <span className="hint">{tr.config.repo ?? tr.config.project ?? tr.config.team}</span>
              </span>
              <span className="hint" role="status">
                {status[tr.id]}
              </span>
              <button
                type="button"
                className="btn sm"
                onClick={async () => {
                  setStatus((s) => ({ ...s, [tr.id]: "…" }));
                  const res = await testTrackerAction(slug, tr.id);
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
                  const res = await deleteTrackerAction(slug, tr.id);
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
        <TrackerForm
          slug={slug}
          tracker={editing === "new" ? null : editing}
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
      <p className="hint">{t("assignee")}</p>
    </section>
  );
}

function TrackerForm({
  slug,
  tracker,
  onDone,
  onError,
}: {
  slug: string;
  tracker: TrackerView | null;
  onDone: () => void;
  onError: (e: string | null) => void;
}) {
  const t = useTranslations("trackers");
  const [kind, setKind] = useState<Kind>(tracker?.kind ?? "github");
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
        const res = await saveTrackerAction(slug, {
          ...(tracker ? { id: tracker.id } : {}),
          kind,
          name: name || t(`kinds.${kind}`),
          config: Object.fromEntries(FIELDS[kind].map((f) => [f.key, (config[f.key] ?? "").trim()])),
          token,
        });
        setBusy(false);
        if (!res.ok) return onError(res.error);
        if (!tracker) track("integration_connected", { kind: "tracker-" + kind });
        onError(null);
        onDone();
      }}
    >
      <div className="grid2">
        <div className="field">
          <label htmlFor="trKind">{t("kind")}</label>
          <Select id="trKind" value={kind} disabled={!!tracker} onChange={(e) => setKind(e.target.value as Kind)}>
            {(["github", "gitlab", "jira", "linear"] as const).map((k) => (
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
          <label htmlFor="trToken">{t("token")}</label>
          <input
            id="trToken"
            type="password"
            autoComplete="off"
            required={!tracker}
            value={token}
            placeholder={tracker ? "••••" : ""}
            onChange={(e) => setToken(e.target.value)}
          />
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
