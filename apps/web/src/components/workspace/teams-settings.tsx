"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { setTeamsRemindersAction, unlinkTeamsAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import type { TeamsView } from "@/lib/server/teams";
import { withBasePath } from "@/lib/shared/base-path";
import { track } from "@/lib/shared/track";
import { Icon } from "../shell/icons";
import { NewTab } from "../shell/new-tab";
import type { useConfirm } from "./confirm";

type ConfirmFn = ReturnType<typeof useConfirm>[1];

export interface TeamsSettingsProps extends TeamsView {
  slug: string;
  /** The plan includes the Teams app */
  available: boolean;
  plansUrl: string | null;
  /** How the instance's administrator registers the Teams app */
  setupUrl: string;
}

/** The Microsoft Teams app of the workspace (Team): reminders and check-ins in Teams, a channel for notifications */
export function TeamsSettings({ confirm, ...p }: TeamsSettingsProps & { confirm: ConfirmFn }) {
  const t = useTranslations("teams.settings");
  const tm = useTranslations("modules");
  const router = useRouter();
  // Back from the link page with the team linked
  const linkedNow = useSearchParams().get("teams") === "linked";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (linkedNow) track("teams_linked");
  }, [linkedNow]);

  const head = (
    <h2 id="teams-title">
      <TeamsMark /> Microsoft Teams
    </h2>
  );
  const uses = (
    <ul className="slack-uses">
      <li>{t("uses.reminders")}</li>
      <li>{t("uses.channel")}</li>
      <li>{t("uses.command")}</li>
    </ul>
  );
  if (!p.available)
    return (
      <section className="panel slack-settings" id="teams" aria-labelledby="teams-title">
        {head}
        <p className="muted">{t("intro")}</p>
        {uses}
        <div className="logo-locked">
          <p className="muted">{t("locked", { edition: tm("editions.team") })}</p>
          {p.plansUrl && (
            <a
              data-umami-event="upgrade_click"
              data-umami-event-from="teams-settings"
              className="link"
              href={p.plansUrl}
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

  const reminders = async (on: boolean) => {
    setBusy(true);
    setError(null);
    const res = await setTeamsRemindersAction(p.slug, on);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  };
  const unlink = async () => {
    if (!(await confirm({ message: t("unlinkConfirm"), confirmLabel: t("unlink"), danger: true }))) return;
    setBusy(true);
    setError(null);
    const res = await unlinkTeamsAction(p.slug);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.replace(`/w/${p.slug}/settings#teams`);
    router.refresh();
  };

  return (
    <section className="panel slack-settings" id="teams" aria-labelledby="teams-title">
      {head}
      {!p.linked && <p className="muted">{t("intro")}</p>}
      {linkedNow && p.linked && <FormAlert tone="ok">{t("linked")}</FormAlert>}
      <FormAlert>{error}</FormAlert>
      {p.linked ? (
        <>
          <div className="slack-connected">
            <span className="slack-dot" aria-hidden="true" />
            <span>
              <strong>{t("linkedTo", { team: p.linked.teamName })}</strong>
              {p.linked.channelName && <span className="hint"> · {t("channel", { channel: p.linked.channelName })}</span>}
            </span>
          </div>
          {uses}
          <label className="check">
            <input type="checkbox" checked={p.linked.reminders} disabled={busy} onChange={(e) => void reminders(e.target.checked)} />{" "}
            <span>
              <strong>{t("reminders")}</strong>
              <span className="hint">{t("remindersHint")}</span>
            </span>
          </label>
          <div className="form-foot">
            <a className="btn" href={withBasePath("/api/teams/package")} download>
              <Icon name="download" size={16} /> {t("download")}
            </a>
            <button type="button" className="btn danger" onClick={() => void unlink()} disabled={busy}>
              {t("unlink")}
            </button>
          </div>
        </>
      ) : p.configured ? (
        <>
          {uses}
          <ol className="teams-steps">
            <li>
              <strong>{t("step1")}</strong>
              <span className="hint">{t("step1Hint")}</span>
              <a className="btn primary" href={withBasePath("/api/teams/package")} download>
                <Icon name="download" size={16} /> {t("download")}
              </a>
            </li>
            <li>
              <strong>{t("step2")}</strong>
              {p.openUrl && (
                <a className="btn" href={p.openUrl} target="_blank" rel="noopener">
                  {t("openInTeams")}
                  <NewTab />
                </a>
              )}
            </li>
            <li>
              <strong>{t("step3")}</strong>
            </li>
          </ol>
          <p className="hint">{t("emailMatch")}</p>
        </>
      ) : (
        <div className="logo-locked">
          <p className="muted">{t("notConfigured")}</p>
          <a className="link" href={p.setupUrl} target="_blank" rel="noopener">
            {t("setup")}
            <NewTab />
          </a>
        </div>
      )}
    </section>
  );
}

/** A mark for Teams, in its purple: a "T" on a tile */
export function TeamsMark() {
  return (
    <svg className="slack-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="1" y="3" width="17" height="18" rx="4" fill="#5059C9" />
      <circle cx="19.5" cy="6.5" r="3" fill="#7B83EB" />
      <path d="M5 8h9v2.4h-3.3V17H8.3v-6.6H5z" fill="#fff" />
    </svg>
  );
}
