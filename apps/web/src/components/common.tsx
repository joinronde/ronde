"use client";

import { formatters } from "@ronde/i18n";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

export { Modal } from "@ronde/ui/modal";

import { DateInput } from "./date-input";
import { EmptyHero } from "./illustration";
import { useRonde } from "./ronde-provider";

export function NoMeeting() {
  const t = useTranslations("common");
  const locale = useLocale();
  const { s, rpc, host } = useRonde();
  // The next date of the schedule, otherwise today
  const [date, setDate] = useState(
    () => s.settings.schedule.upcoming.find((o) => !o.cancelled)?.date ?? new Date().toISOString().slice(0, 10),
  );
  return (
    <EmptyHero art="meetings" title={t("noMeeting.title")} compact>
      {!s.viewer.isHost ? (
        <p>{t("noMeeting.notPrepared", { host })}</p>
      ) : s.members.length ? (
        <>
          <p>{t("noMeeting.pickDate")}</p>
          <div className="controls" style={{ justifyContent: "center" }}>
            <label htmlFor="newMeetingDate" className="sr-only">
              {t("noMeeting.dateLabel")}
            </label>
            <DateInput id="newMeetingDate" required value={date} onChange={setDate} className="auto" />
            <button className="btn primary" disabled={!date} onClick={() => rpc({ op: "meeting.create", date })}>
              {t("noMeeting.prepare", { date: formatters(locale).dateShort(date) })}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">{t("noMeeting.addTeamFirst")}</p>
          <Link className="btn" href={`${s.context.path}/settings`}>
            {t("noMeeting.openSettings")}
          </Link>
        </>
      )}
    </EmptyHero>
  );
}

/** Data that could not be loaded, with a retry button */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("common");
  return (
    <EmptyHero art="error" title={t("loadError.title")} hint={t("loadError.body")} compact alert>
      <button type="button" className="btn primary" onClick={onRetry}>
        {t("loadError.retry")}
      </button>
    </EmptyHero>
  );
}

/** Copy to the clipboard, falling back to selecting the text */
export async function copyText(text: string, fallback?: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    fallback?.select();
    return false;
  }
}

/** Download a file generated in the browser */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
