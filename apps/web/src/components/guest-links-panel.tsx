"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";
import { createGuestLinkAction, listGuestLinksAction, revokeGuestLinkAction } from "@/app/w/[ws]/actions";
import type { GuestLinkView } from "@/lib/server/guest-links";
import { useRonde } from "./ronde-provider";
import { Select } from "./select";

const DURATIONS = [1, 7, 30, 90];

/** Links that let people without an account follow the shared screen, until they expire */
export function GuestLinksPanel() {
  const t = useTranslations("guestLinks");
  const format = useFormatter();
  const { s, toast } = useRonde();
  const slug = s.context.workspace.slug;
  const meetingId = s.context.meetingId;
  const id = useId();
  const [links, setLinks] = useState<GuestLinkView[]>([]);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(7);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await listGuestLinksAction(slug, meetingId);
    if (res.ok) setLinks(res.data);
  }, [slug, meetingId]);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await createGuestLinkAction(slug, meetingId, { label, days });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setLabel("");
    setFresh(res.data.url);
    void load();
  };
  const revoke = async (linkId: string) => {
    const res = await revokeGuestLinkAction(slug, meetingId, linkId);
    if (!res.ok) return setError(res.error);
    toast(t("revoked"));
    void load();
  };
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast(t("copied"));
    } catch {}
  };

  return (
    <section className="panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("title")}</h2>
      <p className="hint">{t("intro")}</p>
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}
      {fresh && (
        <div className="note-box guest-fresh" role="status">
          <p>{t("once")}</p>
          <div className="inline-form">
            <input type="text" readOnly value={fresh} onFocus={(e) => e.target.select()} aria-label={t("link")} />
            <button type="button" className="btn primary" onClick={() => void copy(fresh)}>
              {t("copy")}
            </button>
          </div>
        </div>
      )}
      {links.length > 0 && (
        <ul className="guest-list">
          {links.map((l) => (
            <li key={l.id} className={l.expired ? "expired" : undefined}>
              <span>
                <strong>{l.label}</strong>
                <span className="hint">
                  {l.expired
                    ? t("expiredOn", { date: format.dateTime(l.expiresAt, { dateStyle: "medium" }) })
                    : t("until", { date: format.dateTime(l.expiresAt, { dateStyle: "medium" }) })}
                </span>
              </span>
              <button type="button" className="btn sm danger" onClick={() => void revoke(l.id)}>
                {l.expired ? t("remove") : t("revoke")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="inline-form guest-form" onSubmit={(e) => void create(e)}>
        <input
          type="text"
          required
          maxLength={80}
          placeholder={t("labelPlaceholder")}
          aria-label={t("label")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Select aria-label={t("duration")} value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          {DURATIONS.map((d) => (
            <option key={d} value={d}>
              {t("days", { count: d })}
            </option>
          ))}
        </Select>
        <button type="submit" className="btn" disabled={busy} aria-busy={busy}>
          {t("create")}
        </button>
      </form>
    </section>
  );
}
