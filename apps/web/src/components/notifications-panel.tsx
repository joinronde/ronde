"use client";

import { NOTIFY_EVENTS, type NotifyEvent } from "@ronde/core/notify";
import type { NotifyConnectorDTO, NotifyRuleDTO } from "@ronde/core/types";
import { WORKFLOW_FIELDS, WORKFLOW_OPS, WORKFLOW_VARIABLES, type WorkflowField, type WorkflowOp } from "@ronde/core/workflows";
import { hasFeature } from "@ronde/editions";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Select } from "@/components/select";
import { useRonde } from "./ronde-provider";
import { Icon } from "./shell/icons";
import { NewTab } from "./shell/new-tab";

type Draft = Omit<NotifyRuleDTO, "id"> & { id?: string };

const CHAT_PRESET: { event: NotifyEvent; options?: Record<string, number> }[] = [
  { event: "checkin.reminder" },
  { event: "session.soon", options: { minutesBefore: 10 } },
  { event: "session.started" },
  { event: "minutes.published" },
];
const EMAIL_PRESET: { event: NotifyEvent; audience: string }[] = [
  { event: "minutes.published", audience: "participants" },
  { event: "action.overdue", audience: "hosts" },
];

const defaultTarget = (kind: NotifyConnectorDTO["kind"]): Record<string, string> =>
  kind === "email" || kind === "sms" || kind === "whatsapp" ? { audience: "participants" } : kind === "matrix" ? { room: "" } : {};
const defaultOptions = (event: NotifyEvent): Record<string, number> =>
  event === "session.soon" ? { minutesBefore: 10 } : event === "action.overdue" ? { days: 7 } : {};

/**
 * Notifications of a meeting: "when this happens, send through this connector, there". Connectors are set
 * up once for the workspace; the rules are saved with their own button.
 */
export function NotificationsPanel() {
  const t = useTranslations("notifyRules");
  const tKinds = useTranslations("connectors.kinds");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const { s, rpc } = useRonde();
  const n = s.notifications;
  const saved = n?.rules ?? [];
  const [rules, setRules] = useState<Draft[]>(saved);
  const [open, setOpen] = useState<number | null>(null);
  const workflows = hasFeature(s.edition, "modules.workflows");
  const savedKey = JSON.stringify(saved);
  // A save (here or in another browser) brings the saved rules back
  useEffect(() => setRules(JSON.parse(savedKey)), [savedKey]);
  if (!n) return null;
  const connectors = n.connectors;
  const byId = new Map(connectors.map((c) => [c.id, c]));
  const dirty = JSON.stringify(rules) !== savedKey;
  const settingsLink = `/w/${s.context.workspace.slug}/settings#connectors`;

  // Message keys cannot hold dots: "session.soon" is "events.session_soon"
  const eventLabel = (event: string) => t(`events.${event.replace(".", "_")}` as "events.birthday");
  // Failures are stored as "<error key> <values>", translated here
  const errorText = (error: string) => {
    const [key = "", ...rest] = error.split(" ");
    if (!tErrors.has(key as "unexpected")) return t("failed");
    try {
      return tErrors(key as "unexpected", rest.length ? JSON.parse(rest.join(" ")) : {});
    } catch {
      return t("failed");
    }
  };
  const patch = (i: number, p: Partial<Draft>) => setRules((list) => list.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const add = (connector: NotifyConnectorDTO, event: NotifyEvent, target?: Record<string, string>, options?: Record<string, number>) => ({
    connectorId: connector.id,
    event,
    target: target ?? defaultTarget(connector.kind),
    options: options ?? defaultOptions(event),
    conditions: [],
    message: null,
    enabled: true,
  });
  const save = () =>
    rpc(
      {
        op: "notifications.save",
        rules: rules.map((r) => ({
          id: r.id,
          connectorId: r.connectorId,
          event: r.event,
          target: r.target,
          options: r.options,
          conditions: r.conditions,
          message: r.message,
          enabled: r.enabled,
        })),
      },
      t("saved"),
    );
  const preset = (c: NotifyConnectorDTO) =>
    setRules((list) => [
      ...list,
      ...(c.kind === "email"
        ? EMAIL_PRESET.map((p) => add(c, p.event, { audience: p.audience }))
        : CHAT_PRESET.map((p) => add(c, p.event, undefined, p.options))),
    ]);

  return (
    <div className="panel form">
      <h3 style={{ margin: 0 }}>{t("title")}</h3>
      <p className="hint">{t("intro")}</p>
      {connectors.length === 0 ? (
        <div className="note-box">
          {n.canManageConnectors ? (
            <>
              {t("noConnector")} <Link href={settingsLink}>{t("addConnector")}</Link>
            </>
          ) : (
            t("noConnectorAskAdmin")
          )}
        </div>
      ) : (
        <>
          {rules.length === 0 && (
            <div className="note-box">
              <p style={{ marginTop: 0 }}>{t("empty")}</p>
              <div className="controls">
                {connectors.map((c) => (
                  <button key={c.id} type="button" className="btn" onClick={() => preset(c)}>
                    {t("usePreset", { name: c.name })}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ul className="notify-rules">
            {rules.map((r, i) => {
              const c = byId.get(r.connectorId);
              return (
                <li key={r.id ?? `new-${i}`} className={r.enabled ? "" : "off"}>
                  <div className="grid2">
                    <div className="field">
                      <label htmlFor={`nrEvent${i}`}>{t("when")}</label>
                      <Select
                        id={`nrEvent${i}`}
                        value={r.event}
                        onChange={(e) => {
                          const event = e.target.value as NotifyEvent;
                          // Conditions name the figures of an event: they go with it
                          patch(i, { event, options: defaultOptions(event), conditions: [] });
                        }}
                      >
                        {NOTIFY_EVENTS.map((ev) => (
                          <option key={ev} value={ev}>
                            {eventLabel(ev)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="field">
                      <label htmlFor={`nrConn${i}`}>{t("through")}</label>
                      <Select
                        id={`nrConn${i}`}
                        value={r.connectorId}
                        onChange={(e) => {
                          const next = byId.get(e.target.value);
                          if (next) patch(i, { connectorId: next.id, target: defaultTarget(next.kind) });
                        }}
                      >
                        {connectors.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name} ({tKinds(x.kind)})
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <div className="controls wrap">
                    {r.event === "session.soon" && (
                      <label className="check">
                        <Select
                          aria-label={t("minutesBefore")}
                          value={r.options.minutesBefore ?? 10}
                          onChange={(e) => patch(i, { options: { minutesBefore: Number(e.target.value) } })}
                          style={{ width: "auto" }}
                        >
                          {[5, 10, 15, 30, 60].map((m) => (
                            <option key={m} value={m}>
                              {t("minutesBeforeValue", { m })}
                            </option>
                          ))}
                        </Select>
                      </label>
                    )}
                    {r.event === "action.overdue" && (
                      <label className="check">
                        {t("overdueAfter")}{" "}
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={r.options.days ?? 7}
                          onChange={(e) => patch(i, { options: { days: Number(e.target.value) || 7 } })}
                          style={{ width: "5em" }}
                        />{" "}
                        {t("days")}
                      </label>
                    )}
                    {c?.kind === "matrix" && (
                      <input
                        type="text"
                        aria-label={t("room")}
                        placeholder={t("roomPlaceholder")}
                        value={r.target.room ?? ""}
                        pattern="[!#][^:\s]+:\S+"
                        onChange={(e) => patch(i, { target: { room: e.target.value.trim() } })}
                        style={{ flex: 1, minWidth: "12em" }}
                      />
                    )}
                    {(c?.kind === "email" || c?.kind === "sms" || c?.kind === "whatsapp") && (
                      <Select
                        aria-label={t("audience")}
                        value={r.target.audience ?? "participants"}
                        onChange={(e) => patch(i, { target: { audience: e.target.value } })}
                        style={{ width: "auto" }}
                      >
                        <option value="participants">{t("audienceParticipants")}</option>
                        <option value="hosts">{t("audienceHosts")}</option>
                      </Select>
                    )}
                    <label className="check">
                      <input type="checkbox" checked={r.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} /> {t("enabled")}
                    </label>
                    <button
                      type="button"
                      className="linkbtn"
                      onClick={() => rpc({ op: "notifications.test", connectorId: r.connectorId, target: r.target }, t("testSent"))}
                    >
                      {t("test")}
                    </button>
                    {(workflows || r.conditions.length > 0 || !!r.message) && (
                      <button
                        type="button"
                        className={`linkbtn wf-toggle${r.conditions.length || r.message ? " on" : ""}`}
                        aria-expanded={open === i}
                        onClick={() => setOpen(open === i ? null : i)}
                      >
                        <Icon name="settings" size={14} /> {t("workflow.toggle")}
                        {(r.conditions.length > 0 || r.message) && (
                          <span className="wf-count">{r.conditions.length + (r.message ? 1 : 0)}</span>
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t("remove")}
                      onClick={() => setRules((list) => list.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </div>
                  {open === i && <WorkflowEditor rule={r} available={workflows} plans={s.upgradeHints} onChange={(p) => patch(i, p)} />}
                </li>
              );
            })}
          </ul>
          <div className="controls">
            <button
              type="button"
              className="btn"
              onClick={() => connectors[0] && setRules((list) => [...list, add(connectors[0]!, "checkin.reminder")])}
            >
              + {t("add")}
            </button>
            <button type="button" className="btn primary" disabled={!dirty} onClick={() => void save()}>
              {t("save")}
            </button>
            {n.canManageConnectors && (
              <Link href={settingsLink} className="hint">
                {t("manageConnectors")}
              </Link>
            )}
          </div>
        </>
      )}
      {n.deliveries.length > 0 && (
        <details>
          <summary className="hint">{t("recent")}</summary>
          <ul className="notify-log">
            {n.deliveries.map((d) => (
              <li key={d.id} className={d.status}>
                <span aria-hidden="true">
                  {d.status === "sent" ? "✓" : d.status === "failed" ? "⚠" : d.status === "skipped" ? "⤼" : "…"}
                </span>{" "}
                {eventLabel(d.event)} · {byId.get(d.connectorId)?.name ?? "?"} ·{" "}
                {format.dateTime(d.at, { dateStyle: "short", timeStyle: "short" })}
                {d.status === "failed" && d.error ? <span className="hint"> · {errorText(d.error)}</span> : null}
                {d.status === "skipped" && <span className="hint"> · {t("workflow.skipped")}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Workflows (Team): when the rule sends, and with which words */
function WorkflowEditor({
  rule,
  available,
  plans,
  onChange,
}: {
  rule: Draft;
  available: boolean;
  plans: string | null;
  onChange: (p: Partial<Draft>) => void;
}) {
  const t = useTranslations("notifyRules.workflow");
  const tm = useTranslations("modules");
  const tf = useTranslations("features");
  const fields = WORKFLOW_FIELDS[rule.event];
  const message = rule.message ?? { title: "", body: "" };
  const setMessage = (p: Partial<typeof message>) => {
    const next = { ...message, ...p };
    onChange({ message: next.title || next.body ? next : null });
  };
  return (
    <div className="wf-editor">
      {!available && (
        <p className="hint wf-locked">
          {tm("upgrade.comesWith", { feature: tf("modules.workflows"), edition: tm("editions.team") })}{" "}
          {plans && (
            <a
              data-umami-event="upgrade_click"
              data-umami-event-from="notifications-panel"
              className="link"
              href={plans}
              target="_blank"
              rel="noopener"
            >
              {tm("upgrade.plans")}
              <NewTab />
            </a>
          )}
        </p>
      )}
      <fieldset className="plain" disabled={!available}>
        <legend className="lbl-s">{t("conditions")}</legend>
        {rule.conditions.length === 0 && <p className="hint">{t("always")}</p>}
        <ul className="wf-conditions">
          {rule.conditions.map((c, k) => (
            <li key={`${k}-${c.field}`}>
              <span className="hint">{k === 0 ? t("onlyWhen") : t("and")}</span>
              <Select
                className="compact"
                aria-label={t("field")}
                value={c.field}
                onChange={(e) =>
                  onChange({ conditions: rule.conditions.map((x, j) => (j === k ? { ...x, field: e.target.value as WorkflowField } : x)) })
                }
              >
                {fields.map((f) => (
                  <option key={f} value={f}>
                    {t(`fields.${f}`)}
                  </option>
                ))}
              </Select>
              <Select
                className="compact"
                aria-label={t("op")}
                value={c.op}
                onChange={(e) =>
                  onChange({ conditions: rule.conditions.map((x, j) => (j === k ? { ...x, op: e.target.value as WorkflowOp } : x)) })
                }
              >
                {WORKFLOW_OPS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
              <input
                type="number"
                aria-label={t("value")}
                min={0}
                value={c.value}
                onChange={(e) =>
                  onChange({ conditions: rule.conditions.map((x, j) => (j === k ? { ...x, value: Number(e.target.value) || 0 } : x)) })
                }
                style={{ width: "6em" }}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={t("removeCondition")}
                onClick={() => onChange({ conditions: rule.conditions.filter((_, j) => j !== k) })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        {rule.conditions.length < 5 && (
          <button
            type="button"
            className="btn sm"
            onClick={() => onChange({ conditions: [...rule.conditions, { field: fields[0]!, op: ">", value: 0 }] })}
          >
            + {t("addCondition")}
          </button>
        )}
      </fieldset>
      <fieldset className="plain" disabled={!available}>
        <legend className="lbl-s">{t("message")}</legend>
        <p className="hint">{t("messageHint")}</p>
        <input
          type="text"
          aria-label={t("title")}
          placeholder={t("titlePlaceholder")}
          maxLength={160}
          value={message.title}
          onChange={(e) => setMessage({ title: e.target.value })}
        />
        <textarea
          aria-label={t("body")}
          rows={4}
          maxLength={2000}
          placeholder={t("bodyPlaceholder")}
          value={message.body}
          onChange={(e) => setMessage({ body: e.target.value })}
        />
        <div className="wf-vars" role="group" aria-label={t("variables")}>
          {WORKFLOW_VARIABLES.map((v) => (
            <button
              key={v}
              type="button"
              className="chip"
              onClick={() => setMessage({ body: `${message.body}{${v}}` })}
              title={t(`variables_.${v}`)}
            >
              {`{${v}}`}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
