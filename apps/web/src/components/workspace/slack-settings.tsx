"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { disconnectSlackAction, setSlackRemindersAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import type { SlackView } from "@/lib/server/slack";
import { withBasePath } from "@/lib/shared/base-path";
import { track } from "@/lib/shared/track";
import { NewTab } from "../shell/new-tab";
import type { useConfirm } from "./confirm";

type ConfirmFn = ReturnType<typeof useConfirm>[1];

export interface SlackSettingsProps extends SlackView {
  slug: string;
  /** The plan includes the Slack app */
  available: boolean;
  plansUrl: string | null;
  /** How the instance's administrator sets up the Slack app */
  setupUrl: string;
}

/** What came back from Slack after "Add to Slack" */
const RESULTS = ["connected", "cancelled", "denied", "failed"] as const;

/** The Slack app of the workspace (Team): reminders and check-ins in Slack, a channel for the notifications */
export function SlackSettings({ confirm, ...p }: SlackSettingsProps & { confirm: ConfirmFn }) {
  const t = useTranslations("slack.settings");
  const tm = useTranslations("modules");
  const router = useRouter();
  const result = RESULTS.find((r) => r === useSearchParams().get("slack"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Back from Slack with the app installed
  useEffect(() => {
    if (result === "connected") track("slack_connected");
  }, [result]);

  const head = (
    <h2 id="slack-title">
      <SlackMark /> Slack
    </h2>
  );
  const uses = (
    <ul className="slack-uses">
      <li>{t("uses.reminders")}</li>
      <li>{t("uses.channel")}</li>
      <li>{t("uses.command")}</li>
    </ul>
  );
  // Not in the plan: what it does, and where to get it
  if (!p.available)
    return (
      <section className="panel slack-settings" id="slack" aria-labelledby="slack-title">
        {head}
        <p className="muted">{t("intro")}</p>
        {uses}
        <div className="logo-locked">
          <p className="muted">{t("locked", { edition: tm("editions.team") })}</p>
          {p.plansUrl && (
            <a
              data-umami-event="upgrade_click"
              data-umami-event-from="slack-settings"
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
    const res = await setSlackRemindersAction(p.slug, on);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  };
  const disconnect = async () => {
    if (!(await confirm({ message: t("disconnectConfirm"), confirmLabel: t("disconnect"), danger: true }))) return;
    setBusy(true);
    setError(null);
    const res = await disconnectSlackAction(p.slug);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.replace(`/w/${p.slug}/settings#slack`);
    router.refresh();
  };

  return (
    <section className="panel slack-settings" id="slack" aria-labelledby="slack-title">
      {head}
      {!p.connected && <p className="muted">{t("intro")}</p>}
      {result && (
        <FormAlert tone={result === "connected" ? "ok" : result === "cancelled" ? "info" : "error"}>{t(`result.${result}`)}</FormAlert>
      )}
      <FormAlert>{error}</FormAlert>
      {p.connected ? (
        <>
          <div className="slack-connected">
            <span className="slack-dot" aria-hidden="true" />
            <span>
              <strong>{t("connectedTo", { team: p.connected.teamName })}</strong>
              {p.connected.channel && <span className="hint"> · {t("channel", { channel: p.connected.channel })}</span>}
            </span>
          </div>
          {uses}
          <label className="check">
            <input type="checkbox" checked={p.connected.reminders} disabled={busy} onChange={(e) => void reminders(e.target.checked)} />{" "}
            <span>
              <strong>{t("reminders")}</strong>
              <span className="hint">{t("remindersHint")}</span>
            </span>
          </label>
          <div className="form-foot">
            <a className="btn" href={withBasePath(`/api/slack/install?w=${p.slug}`)}>
              {t("reinstall")}
            </a>
            <button type="button" className="btn danger" onClick={() => void disconnect()} disabled={busy}>
              {t("disconnect")}
            </button>
          </div>
        </>
      ) : p.configured ? (
        <>
          {uses}
          <p className="hint">{t("emailMatch")}</p>
          <div className="form-foot">
            <a className="btn primary slack-add" href={withBasePath(`/api/slack/install?w=${p.slug}`)}>
              <SlackMark /> {t("add")}
            </a>
          </div>
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

/** Slack's mark, in its colours */
function SlackMark() {
  return (
    <svg className="slack-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#E01E5A" d="M5.04 15.17a2.53 2.53 0 1 1-2.52-2.53h2.52zm1.27 0a2.53 2.53 0 0 1 5.05 0v6.31a2.53 2.53 0 1 1-5.05 0z" />
      <path fill="#36C5F0" d="M8.83 5.04a2.53 2.53 0 1 1 2.53-2.52v2.52zm0 1.27a2.53 2.53 0 0 1 0 5.05H2.52a2.53 2.53 0 0 1 0-5.05z" />
      <path fill="#2EB67D" d="M18.96 8.83a2.53 2.53 0 1 1 2.52 2.53h-2.52zm-1.27 0a2.53 2.53 0 0 1-5.05 0V2.52a2.53 2.53 0 1 1 5.05 0z" />
      <path fill="#ECB22E" d="M15.17 18.96a2.53 2.53 0 1 1-2.53 2.52v-2.52zm0-1.27a2.53 2.53 0 0 1 0-5.05h6.31a2.53 2.53 0 0 1 0 5.05z" />
    </svg>
  );
}
