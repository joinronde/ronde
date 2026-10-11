"use client";

import { formatters } from "@ronde/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { withBasePath } from "@/lib/shared/base-path";
import { useRonde } from "./ronde-provider";
import { Icon } from "./shell/icons";

/** Next sessions with "I'll be there / I'll be away", and a link to subscribe in a calendar app */
export function UpcomingSessions() {
  const t = useTranslations("upcoming");
  const fmt = formatters(useLocale());
  const { s, rpc } = useRonde();
  const me = s.viewer.memberId;
  const list = s.settings.schedule.upcoming.filter((o) => !o.cancelled).slice(0, 4);
  return (
    <div className="panel">
      <h3>{t("title")}</h3>
      {list.length === 0 ? (
        <p className="hint">{t("none")}</p>
      ) : (
        <ul className="rsvp-list">
          {list.map((o) => {
            const answer = me ? s.attendance[o.key]?.[me] : undefined;
            return (
              <li key={o.key}>
                <span className="occ-when">
                  <strong>{fmt.dateShort(o.date)}</strong> · {o.time}
                  {o.moved && <span className="st-pill st-doing">{t("moved")}</span>}
                </span>
                {me && (
                  <span className="seg" role="group" aria-label={t("attendanceOf", { date: fmt.dateShort(o.date) })}>
                    <button
                      type="button"
                      aria-pressed={answer === "yes"}
                      onClick={() => rpc({ op: "attendance.set", key: o.key, status: answer === "yes" ? null : "yes" })}
                    >
                      {t("yes")}
                    </button>
                    <button
                      type="button"
                      aria-pressed={answer === "no"}
                      onClick={() =>
                        rpc(
                          { op: "attendance.set", key: o.key, status: answer === "no" ? null : "no" },
                          answer === "no" ? undefined : t("noted"),
                        )
                      }
                    >
                      {t("no")}
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {me && <p className="hint">{t("hint")}</p>}
      <CalendarLink />
    </div>
  );
}

/** Secret link to subscribe to the meeting in a calendar app (a new link revokes the previous one) */
export function CalendarLink({ personal }: { personal?: boolean }) {
  const t = useTranslations("upcoming");
  const ronde = useOptionalApi();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = async () => {
    const endpoint = personal || !ronde ? withBasePath("/api/calendar") : ronde("/calendar");
    const r = await fetch(endpoint, { method: "POST" });
    if (r.ok) setUrl(((await r.json()) as { url: string }).url);
  };
  if (!url)
    return (
      <button type="button" className="btn" onClick={create}>
        <Icon name="calendar" size={15} />
        {personal ? t("subscribeAll") : t("subscribe")}
      </button>
    );
  return (
    <div className="stack">
      <span className="copy-row">
        <input type="text" readOnly value={url} aria-label={t("feedLink")} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="btn"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? t("copied") : t("copy")}
        </button>
      </span>
      <span className="hint">
        {t("feedHint")}{" "}
        <a className="link" href={url.replace(/^https?:/, "webcal:")}>
          {t("openInApp")}
        </a>
      </span>
    </div>
  );
}

/** The meeting API when inside a meeting page; null elsewhere (account page) */
function useOptionalApi(): ((path: string) => string) | null {
  try {
    return useRonde().api;
  } catch {
    return null;
  }
}

/** Who facilitates and who takes notes at this session (rotating roles module) */
export function Assignments() {
  const t = useTranslations("upcoming");
  const { s, nameOf, mod } = useRonde();
  const a = s.meeting?.assignments ?? {};
  if (!mod("rotation") || (!a.facilitator && !a.noteTaker)) return null;
  return (
    <p className="assignments">
      {a.facilitator && (
        <span>
          <Icon name="mic" size={14} /> {t("facilitator", { name: nameOf(a.facilitator) })}
        </span>
      )}
      {a.noteTaker && (
        <span>
          <Icon name="note" size={14} /> {t("noteTaker", { name: nameOf(a.noteTaker) })}
        </span>
      )}
    </p>
  );
}
