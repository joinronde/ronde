"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { setMeetingWikiAction } from "@/app/w/[ws]/actions";
import { Select } from "@/components/select";
import { useRonde } from "./ronde-provider";

/** Where a meeting publishes its minutes (Team): a page in the chosen wiki at each archive */
export function MeetingWikiPanel() {
  const t = useTranslations("wikis");
  const { s, toast } = useRonde();
  const [busy, setBusy] = useState(false);
  // The choice shows at once; the meeting's state confirms it a moment later
  const [picked, setPicked] = useState<string | null>(null);
  const w = s.wikis;
  const current = w?.current?.id;
  useEffect(() => setPicked(null), [current]);
  // Those who only edit the minutes publish from the history; the choice belongs to those who configure the meeting
  if (!w || !w.list.length) {
    if (!w || !s.viewer.isAdmin) return null;
    return (
      <section className="panel form" aria-labelledby="wikiTitle">
        <h3 id="wikiTitle" style={{ margin: 0 }}>
          {t("meeting.title")}
        </h3>
        <p className="hint">{t("meeting.intro")}</p>
        <p className="note-box">
          {t("meeting.noWiki")} <Link href={`/w/${s.context.workspace.slug}/settings`}>{t("meeting.addWiki")}</Link>
        </p>
      </section>
    );
  }
  const choose = async (id: string) => {
    setPicked(id);
    setBusy(true);
    const res = await setMeetingWikiAction(s.context.workspace.slug, s.context.meetingId, id || null);
    setBusy(false);
    if (!res.ok) {
      setPicked(null);
      return toast(res.error, "error");
    }
    const chosen = w.list.find((x) => x.id === id);
    toast(chosen ? t("meeting.on", { name: chosen.name }) : t("meeting.off"), chosen ? "ok" : "off");
  };
  return (
    <section className="panel form" aria-labelledby="wikiTitle">
      <h3 id="wikiTitle" style={{ margin: 0 }}>
        {t("meeting.title")}
      </h3>
      <p className="hint">{t("meeting.intro")}</p>
      <div className="field">
        <label htmlFor="wikiPick">{t("meeting.wiki")}</label>
        <Select id="wikiPick" value={picked ?? w.current?.id ?? ""} disabled={busy} onChange={(e) => void choose(e.target.value)}>
          <option value="">{t("meeting.none")}</option>
          {w.list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} ({t(`kinds.${x.kind}`)})
            </option>
          ))}
        </Select>
        <span className="hint">{t("meeting.hint")}</span>
      </div>
    </section>
  );
}
