"use client";

import { CONNECTOR_KINDS, type ConnectorKind } from "@ronde/connectors/kinds";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { deleteConnectorAction, saveConnectorAction, testConnectorAction } from "@/app/w/[ws]/actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { Select } from "@/components/select";
import type { ConnectorView } from "@/lib/server/notify/connectors";
import { track } from "@/lib/shared/track";
import type { useConfirm } from "./confirm";

type ConfigField = "homeserver" | "url" | "accountSid" | "from";
/** What each kind needs: a homeserver and a token, a webhook address, a Twilio account and number… */
const NEEDS: Record<ConnectorKind, { config?: ConfigField[]; secret?: "token" | "webhookUrl" | "signingKey" | "authToken" }> = {
  email: {},
  matrix: { config: ["homeserver"], secret: "token" },
  slack: { secret: "webhookUrl" },
  teams: { secret: "webhookUrl" },
  discord: { secret: "webhookUrl" },
  mattermost: { secret: "webhookUrl" },
  webhook: { config: ["url"], secret: "signingKey" },
  sms: { config: ["accountSid", "from"], secret: "authToken" },
  whatsapp: { config: ["accountSid", "from"], secret: "authToken" },
};
const PLACEHOLDER: Record<ConfigField, string> = {
  homeserver: "https://matrix.example.org",
  url: "https://example.org/hooks/ronde",
  accountSid: "AC…",
  from: "+33612345678",
};
const PAID: ConnectorKind[] = ["sms", "whatsapp"];

interface Draft {
  id?: string;
  kind: ConnectorKind;
  name: string;
  config: Partial<Record<ConfigField, string>>;
  secret: string;
}

/** Channels the meetings of the workspace can notify; their secrets are never shown again */
export function ConnectorsSection({
  slug,
  connectors,
  canEncrypt,
  phoneOn,
  confirm,
}: {
  slug: string;
  connectors: ConnectorView[];
  canEncrypt: boolean;
  /** SMS and WhatsApp connectors are in the workspace's plan (Team) */
  phoneOn: boolean;
  confirm: ReturnType<typeof useConfirm>[1];
}) {
  const t = useTranslations("connectors");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signingKey, setSigningKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<Record<string, string>>({});

  const start = (kind: ConnectorKind) => {
    setError(null);
    setDraft({ kind, name: t(`kinds.${kind}`), config: {}, secret: "" });
  };
  const edit = (c: ConnectorView) => {
    setError(null);
    const needs = NEEDS[c.kind];
    setDraft({
      id: c.id,
      kind: c.kind,
      name: c.name,
      config: Object.fromEntries((needs.config ?? []).map((f) => [f, String(c.config[f] ?? "")])),
      secret: "",
    });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    const needs = NEEDS[draft.kind];
    const res = await saveConnectorAction(slug, {
      id: draft.id,
      kind: draft.kind,
      name: draft.name,
      config: Object.fromEntries((needs.config ?? []).map((f) => [f, (draft.config[f] ?? "").trim()])),
      ...(draft.secret.trim() ? { secret: draft.secret.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    if (!draft.id) track("integration_connected", { kind: `connector-${draft.kind}` });
    setError(null);
    setDraft(null);
    setSigningKey(res.data.signingKey);
    setNotice(t("saved"));
    router.refresh();
  };
  const test = async (c: ConnectorView) => {
    setNotice(null);
    const res = await testConnectorAction(slug, c.id, rooms[c.id]);
    if (!res.ok) return setError(res.error);
    setError(null);
    setNotice(c.kind === "email" ? t("testSentEmail") : PAID.includes(c.kind) ? t("testSentPhone") : t("testSent"));
    router.refresh();
  };
  const remove = async (c: ConnectorView) => {
    if (!(await confirm({ message: t("deleteConfirm", { name: c.name }), confirmLabel: tCommon("delete"), danger: true }))) return;
    const res = await deleteConnectorAction(slug, c.id);
    if (!res.ok) return setError(res.error);
    setError(null);
    router.refresh();
  };

  const needs = draft ? NEEDS[draft.kind] : null;
  const editing = draft?.id ? connectors.find((c) => c.id === draft.id) : null;

  return (
    <section className="panel" id="connectors" aria-labelledby="connectors-title">
      <h2 id="connectors-title">{t("title")}</h2>
      <p className="hint">{t("intro")}</p>
      {!canEncrypt && <div className="note-box">{t("noSecretKey")}</div>}
      <FormAlert>{error}</FormAlert>
      {notice && (
        <p className="hint" role="status">
          ✓ {notice}
        </p>
      )}
      {signingKey && (
        <div className="note-box" role="status">
          <p style={{ marginTop: 0 }}>{t("signingKeyOnce")}</p>
          <code style={{ overflowWrap: "anywhere" }}>{signingKey}</code>
          <p className="hint">{t("signingKeyHelp")}</p>
        </div>
      )}

      {connectors.length === 0 ? (
        <p className="empty-state">{t("empty")}</p>
      ) : (
        <ul className="connector-list">
          {connectors.map((c) => (
            <li key={c.id}>
              <div>
                <strong>{c.name}</strong> <span className="hint">· {t(`kinds.${c.kind}`)}</span>
                <div className="hint">
                  {t("usedBy", { count: c.rules })}
                  {c.last && ` · ${c.last.status === "failed" ? t("lastFailed") : t("lastSent")} ${format.relativeTime(c.last.at)}`}
                </div>
              </div>
              <div className="controls wrap">
                {c.kind === "matrix" && (
                  <input
                    type="text"
                    aria-label={t("testRoom")}
                    placeholder={t("testRoom")}
                    value={rooms[c.id] ?? ""}
                    onChange={(e) => setRooms((r) => ({ ...r, [c.id]: e.target.value }))}
                    style={{ width: "14em" }}
                  />
                )}
                <button type="button" className="btn" onClick={() => void test(c)} disabled={c.kind === "matrix" && !rooms[c.id]?.trim()}>
                  {t("test")}
                </button>
                <button type="button" className="btn" onClick={() => edit(c)}>
                  {t("edit")}
                </button>
                <button type="button" className="icon-btn" aria-label={t("delete", { name: c.name })} onClick={() => void remove(c)}>
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft && needs ? (
        <form className="form" onSubmit={save}>
          <h3 style={{ margin: 0 }}>
            {draft.id ? t("editTitle", { name: editing?.name ?? draft.name }) : t("addTitle", { kind: t(`kinds.${draft.kind}`) })}
          </h3>
          <p className="hint">{t(`help.${draft.kind}`)}</p>
          <Field label={t("name")}>
            {(p) => (
              <input
                {...p}
                type="text"
                required
                maxLength={80}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            )}
          </Field>
          {needs.config?.map((f) => (
            <Field key={f} label={t(`fields.${f}`)} hint={f === "from" ? t("fromHint") : undefined}>
              {(p) => (
                <input
                  {...p}
                  type={f === "from" ? "tel" : f === "accountSid" ? "text" : "url"}
                  required
                  placeholder={PLACEHOLDER[f]}
                  value={draft.config[f] ?? ""}
                  onChange={(e) => setDraft({ ...draft, config: { ...draft.config, [f]: e.target.value } })}
                />
              )}
            </Field>
          ))}
          {needs.secret && (
            <Field
              label={t(`fields.${needs.secret}`)}
              hint={editing?.secretSet ? t("secretKept") : needs.secret === "signingKey" ? t("signingKeyGenerated") : undefined}
            >
              {(p) => (
                <input
                  {...p}
                  type="password"
                  autoComplete="off"
                  required={!editing?.secretSet && needs.secret !== "signingKey"}
                  value={draft.secret}
                  onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
                />
              )}
            </Field>
          )}
          <div className="form-foot">
            <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
              {t("save")}
            </button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="inline-form">
          <label htmlFor="newConnector" className="hint">
            {t("add")}
          </label>
          <Select
            id="newConnector"
            value=""
            onChange={(e) => {
              if (e.target.value) start(e.target.value as ConnectorKind);
            }}
          >
            <option value="">{t("pickKind")}</option>
            {CONNECTOR_KINDS.map((k) => (
              <option key={k} value={k} disabled={(!canEncrypt && k !== "email") || (PAID.includes(k) && !phoneOn)}>
                {PAID.includes(k) && !phoneOn ? t("paidKind", { kind: t(`kinds.${k}`) }) : t(`kinds.${k}`)}
              </option>
            ))}
          </Select>
        </div>
      )}
    </section>
  );
}
