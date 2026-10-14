"use client";

import type { AuditRow } from "@ronde/editions/ee";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { setAuditStreamAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { DateInput } from "@/components/date-input";
import { Select } from "@/components/select";
import { withBasePath } from "@/lib/shared/base-path";

interface Props {
  slug: string;
  rows: AuditRow[];
  next: string | null;
  filters: { action: string; actor: string; from: string; to: string };
  /** Days of history shown (Team), or null for the whole history */
  days: number | null;
  /** SIEM stream settings, for the people managing the workspace with Enterprise (null otherwise) */
  stream: { connectors: { id: string; name: string }[]; current: string } | null;
}

/** Fields of an entry named in words; the others keep their key */
const FIELDS = [
  "name",
  "slug",
  "locale",
  "timezone",
  "meetingCreation",
  "bufferMin",
  "email",
  "firstName",
  "lastName",
  "role",
  "birthday",
  "phone",
  "label",
  "days",
  "domain",
  "permissions",
  "enabled",
] as const;
type Field = (typeof FIELDS)[number];
const isField = (k: string): k is Field => (FIELDS as readonly string[]).includes(k);
const ROLES = ["owner", "admin", "billing", "organizer", "member", "guest"];

/** Details of an entry, on one line and in words: ids (meaningless to a reader) are left out */
function useDetails() {
  const t = useTranslations("audit");
  const tw = useTranslations("workspace");
  const value = (k: string, v: unknown): string => {
    if (typeof v === "boolean") return v ? t("yes") : t("no");
    if (k === "role" && typeof v === "string" && ROLES.includes(v)) return tw(`roles.${v}` as "roles.owner");
    if (k === "meetingCreation") return v === "admins" ? tw("settings.meetingCreationAdmins") : tw("settings.meetingCreationMembers");
    if (Array.isArray(v)) return v.every((x) => typeof x === "string") ? v.join(", ") : String(v.length);
    return typeof v === "string" ? v : JSON.stringify(v);
  };
  return (data: unknown): string => {
    if (!data || typeof data !== "object") return "";
    return Object.entries(data as Record<string, unknown>)
      .filter(([k, v]) => v !== null && v !== undefined && v !== "" && k !== "id" && !/Ids?$/.test(k))
      .map(([k, v]) => `${isField(k) ? t(`fields.${k}`) : k}: ${value(k, v)}`)
      .join(" · ")
      .slice(0, 240);
  };
}

/** Audit log of the workspace: who did what, newest first, with filters, a CSV export and a SIEM stream */
export function AuditLogView({ slug, rows, next, filters, days, stream }: Props) {
  const t = useTranslations("audit");
  const details = useDetails();
  const locale = useLocale();
  const router = useRouter();
  const [streamTo, setStreamTo] = useState(stream?.current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const label = (action: string) => {
    const key = `actions.${action}` as "actions.meeting.archive";
    return t.has(key) ? t(key) : action;
  };
  return (
    <div className="stack audit">
      <p className="muted">
        {t("intro")} {days !== null && t("window", { days })}
      </p>
      <form className="audit-filters" method="get">
        <label>
          <span className="lbl-s">{t("filters.action")}</span>
          <input name="action" defaultValue={filters.action} placeholder={t("filters.actionPlaceholder")} />
        </label>
        <label>
          <span className="lbl-s">{t("filters.actor")}</span>
          <input name="actor" defaultValue={filters.actor} placeholder={t("filters.actorPlaceholder")} />
        </label>
        <label>
          <span className="lbl-s">{t("filters.from")}</span>
          <DateInput name="from" compact defaultValue={filters.from} />
        </label>
        <label>
          <span className="lbl-s">{t("filters.to")}</span>
          <DateInput name="to" compact defaultValue={filters.to} />
        </label>
        <div className="controls">
          <button type="submit" className="btn">
            {t("filters.apply")}
          </button>
          <a className="btn ghost" href={withBasePath(`/api/w/${slug}/audit?${query}`)} download>
            {t("export")}
          </a>
        </div>
      </form>
      {rows.length ? (
        <div className="table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th scope="col">{t("columns.when")}</th>
                <th scope="col">{t("columns.who")}</th>
                <th scope="col">{t("columns.what")}</th>
                <th scope="col">{t("columns.details")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{when(r.createdAt)}</td>
                  <td>{r.actorLabel}</td>
                  <td>
                    <strong>{label(r.action)}</strong>
                    <span className="hint audit-id">{r.action}</span>
                  </td>
                  <td className="hint">{details(r.data)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="emptybox">{filters.action || filters.actor || filters.from || filters.to ? t("noMatch") : t("empty")}</div>
      )}
      {next && (
        <Link className="btn" href={`?${new URLSearchParams({ ...Object.fromEntries(query), after: next })}`}>
          {t("more")}
        </Link>
      )}
      {stream && (
        <section className="panel stack" aria-labelledby="stream-title">
          <h2 id="stream-title">{t("stream.title")}</h2>
          <p className="hint">{t("stream.hint")}</p>
          <FormAlert>{error}</FormAlert>
          {stream.connectors.length ? (
            <form
              className="controls"
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await setAuditStreamAction(slug, streamTo);
                if (!res.ok) return setError(res.error);
                setError(null);
                setSaved(true);
                router.refresh();
              }}
            >
              <label className="sr-only" htmlFor="auditStream">
                {t("stream.connector")}
              </label>
              <Select
                id="auditStream"
                value={streamTo}
                onChange={(e) => {
                  setSaved(false);
                  setStreamTo(e.target.value);
                }}
              >
                <option value="">{t("stream.none")}</option>
                {stream.connectors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <button type="submit" className="btn primary">
                {t("stream.save")}
              </button>
              <span className="hint" role="status">
                {saved ? `✓ ${t("stream.saved")}` : ""}
              </span>
            </form>
          ) : (
            <p className="note-box">{t("stream.noWebhook")}</p>
          )}
        </section>
      )}
    </div>
  );
}
