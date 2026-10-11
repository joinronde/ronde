"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteCalendarAccountAction, saveCalendarAccountAction, testCalendarAccountAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { Select } from "@/components/select";
import type { CalendarAccountView } from "@/lib/server/calendars";
import { track } from "@/lib/shared/track";
import { NewTab } from "../shell/new-tab";
import type { useConfirm } from "./confirm";

type ConfirmFn = ReturnType<typeof useConfirm>[1];

type Kind = CalendarAccountView["kind"];

/** Fields each provider asks for, with an example */
const FIELDS: Record<Kind, { key: "clientEmail" | "organizer" | "tenant" | "clientId"; placeholder: string }[]> = {
  google: [
    { key: "clientEmail", placeholder: "ronde@acme.iam.gserviceaccount.com" },
    { key: "organizer", placeholder: "rooms@acme.com" },
  ],
  microsoft: [
    { key: "tenant", placeholder: "acme.onmicrosoft.com" },
    { key: "clientId", placeholder: "00000000-0000-0000-0000-000000000000" },
    { key: "organizer", placeholder: "rooms@acme.com" },
  ],
};

export interface CalendarAccountsSettingsProps {
  slug: string;
  accounts: CalendarAccountView[];
  available: boolean;
  plansUrl: string | null;
}

/** Calendar accounts of the workspace: sessions go into calendars, availability comes back (Team) */
export function CalendarAccountsSettings({
  slug,
  accounts,
  available,
  plansUrl,
  confirm,
}: CalendarAccountsSettingsProps & { confirm: ConfirmFn }) {
  const t = useTranslations("calendarAccounts");
  const tm = useTranslations("modules");
  const tf = useTranslations("features");
  const router = useRouter();
  const [editing, setEditing] = useState<CalendarAccountView | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});

  if (!available)
    return (
      <section className="panel" aria-labelledby="calendar-title">
        <h2 id="calendar-title">{t("title")}</h2>
        <div className="logo-locked">
          <p className="muted">{tm("upgrade.comesWith", { feature: tf("scheduling.calendarSync"), edition: tm("editions.team") })}</p>
          {plansUrl && (
            <a
              data-umami-event="upgrade_click"
              data-umami-event-from="calendar-accounts-settings"
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
    <section className="panel calendar-accounts" aria-labelledby="calendar-title">
      <h2 id="calendar-title">{t("title")}</h2>
      <p className="muted">{t("intro")}</p>
      <FormAlert>{error}</FormAlert>
      {accounts.length ? (
        <ul className="tracker-list">
          {accounts.map((tr) => (
            <li key={tr.id}>
              <span className={`tracker-badge ${tr.kind}`}>{t(`kinds.${tr.kind}`)}</span>
              <span className="tracker-text">
                <strong>{tr.name}</strong>
                <span className="hint">{tr.config.organizer}</span>
              </span>
              <span className="hint" role="status">
                {status[tr.id]}
              </span>
              <button
                type="button"
                className="btn sm"
                onClick={async () => {
                  setStatus((s) => ({ ...s, [tr.id]: "…" }));
                  const res = await testCalendarAccountAction(slug, tr.id);
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
                  const res = await deleteCalendarAccountAction(slug, tr.id);
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
      <p className="hint">{t("useIt")}</p>
    </section>
  );
}

function AccountForm({
  slug,
  account: tracker,
  onDone,
  onError,
}: {
  slug: string;
  account: CalendarAccountView | null;
  onDone: () => void;
  onError: (e: string | null) => void;
}) {
  const t = useTranslations("calendarAccounts");
  const [kind, setKind] = useState<Kind>(tracker?.kind ?? "google");
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
        const res = await saveCalendarAccountAction(slug, {
          ...(tracker ? { id: tracker.id } : {}),
          kind,
          name: name || t(`kinds.${kind}`),
          config: Object.fromEntries(FIELDS[kind].map((f) => [f.key, (config[f.key] ?? "").trim()])),
          secret: token,
        });
        setBusy(false);
        if (!res.ok) return onError(res.error);
        if (!tracker) track("integration_connected", { kind: "calendar-" + kind });
        onError(null);
        onDone();
      }}
    >
      <div className="grid2">
        <div className="field">
          <label htmlFor="trKind">{t("kind")}</label>
          <Select id="trKind" value={kind} disabled={!!tracker} onChange={(e) => setKind(e.target.value as Kind)}>
            {(["google", "microsoft"] as const).map((k) => (
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
          {kind === "google" ? (
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
