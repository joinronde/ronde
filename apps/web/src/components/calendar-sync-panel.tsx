"use client";

import { formatters, type Locale } from "@ronde/i18n";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { meetingAvailabilityAction, setMeetingCalendarAction, syncMeetingCalendarAction } from "@/app/w/[ws]/actions";
import { Select } from "@/components/select";
import type { Availability } from "@/lib/server/calendars";
import { useRonde } from "./ronde-provider";

/** Calendar sync of a meeting (Team): sessions in the participants' calendars, conflicts, free slots */
export function CalendarSyncPanel() {
  const t = useTranslations("calendarSync");
  const { s, toast } = useRonde();
  const fmt = formatters(useLocale() as Locale);
  const [busy, setBusy] = useState<"save" | "sync" | "check" | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const c = s.calendars;
  const slug = s.context.workspace.slug;
  const meetingId = s.context.meetingId;
  if (!c) return null;

  const choose = async (accountId: string) => {
    setBusy("save");
    const res = await setMeetingCalendarAction(slug, meetingId, accountId || null);
    setBusy(null);
    if (!res.ok) return toast(res.error);
    setAvailability(null);
    toast(accountId ? t("written", { count: res.data }) : t("removed"));
  };
  const sync = async () => {
    setBusy("sync");
    const res = await syncMeetingCalendarAction(slug, meetingId);
    setBusy(null);
    toast(res.ok ? t("synced", { count: res.data }) : res.error);
  };
  const check = async () => {
    setBusy("check");
    const res = await meetingAvailabilityAction(slug, meetingId);
    setBusy(null);
    if (!res.ok) return toast(res.error);
    setAvailability(res.data);
  };

  return (
    <section className="panel form calendar-sync" aria-labelledby="calSyncTitle">
      <h3 id="calSyncTitle" style={{ margin: 0 }}>
        {t("title")}
      </h3>
      <p className="hint">{t("intro")}</p>
      {c.accounts.length === 0 ? (
        <p className="note-box">
          {t("noAccount")} <Link href={`/w/${slug}/settings`}>{t("addAccount")}</Link>
        </p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="calAccount">{t("account")}</label>
            <Select id="calAccount" value={c.current ?? ""} disabled={!!busy} onChange={(e) => void choose(e.target.value)}>
              <option value="">{t("none")}</option>
              {c.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <span className="hint">{t("accountHint")}</span>
          </div>
          {c.current && (
            <div className="controls">
              <button type="button" className="btn" disabled={!!busy} aria-busy={busy === "sync"} onClick={() => void sync()}>
                {t("syncNow")}
              </button>
              <button type="button" className="btn" disabled={!!busy} aria-busy={busy === "check"} onClick={() => void check()}>
                {t("check")}
              </button>
            </div>
          )}
          {availability && (
            <div className="cal-avail">
              <h4 className="lbl-s">{t("coming")}</h4>
              <ul className="cal-avail-list">
                {availability.sessions.map((o) => (
                  <li key={`${o.date}-${o.time}`} className={o.busy.length ? "conflict" : "free"}>
                    <span>
                      {fmt.dateShort(o.date)} · {o.time}
                    </span>
                    {o.busy.length ? (
                      <span className="st-pill act-late">{t("busy", { names: fmt.list(o.busy) })}</span>
                    ) : (
                      <span className="st-pill st-done">{t("allFree")}</span>
                    )}
                  </li>
                ))}
              </ul>
              <h4 className="lbl-s">{t("slots")}</h4>
              {availability.slots.length ? (
                <ul className="cal-slots">
                  {availability.slots.map((sl) => (
                    <li key={`${sl.date}-${sl.time}`}>
                      <strong>{sl.time}</strong> {fmt.dateShort(sl.date)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint">{t("noSlot")}</p>
              )}
              {availability.unknown.length > 0 && <p className="hint">{t("unknown", { names: fmt.list(availability.unknown) })}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
