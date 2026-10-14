import { resolveLocale } from "@ronde/i18n";
import { getTranslations } from "next-intl/server";
import { WorkspaceSettingsView } from "@/components/workspace/settings";
import { AI_MODELS, aiOn, DEFAULT_AI_MODEL, instanceAiKey } from "@/lib/server/ai";
import { pageWorkspace } from "@/lib/server/authz";
import { brandingOn } from "@/lib/server/branding";
import { calendarSyncOn, listCalendarAccounts } from "@/lib/server/calendars";
import { env } from "@/lib/server/env";
import { holidayCountries, holidayRegions } from "@/lib/server/holidays";
import { featureOn, isCloud } from "@/lib/server/license";
import { listConnectors } from "@/lib/server/notify/connectors";
import { plansUrl } from "@/lib/server/plans";
import { publicUrl } from "@/lib/server/public-url";
import { canEncrypt, decryptSecret } from "@/lib/server/secrets";
import { slackOn, slackView } from "@/lib/server/slack";
import { teamsOn, teamsView } from "@/lib/server/teams";
import { listTrackers, trackersOn } from "@/lib/server/trackers";
import { transcriptionOn } from "@/lib/server/transcripts";
import { listVideoAccounts, videoLinksOn } from "@/lib/server/video-accounts";
import { listWikis, wikisOn } from "@/lib/server/wikis";

export async function generateMetadata() {
  const t = await getTranslations("workspace.settings");
  return { title: `${t("title")} · Ronde` };
}

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ ws: string }> }) {
  const ctx = await pageWorkspace((await params).ws);
  const categories = await ctx.db.jobCategory.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } });
  const canConnect = ctx.can("connectors.manage");
  const available = brandingOn(ctx.workspace);
  const plans = await plansUrl(ctx);
  const logo = available ? await ctx.db.workspaceLogo.findFirst({ select: { updatedAt: true } }) : null;
  // A section of a paid plan the workspace lacks is left out: the plans are presented in their own tab
  const branding =
    ctx.can("workspace.manage") && available
      ? { slug: ctx.workspace.slug, available, logo: logo ? logo.updatedAt.getTime() : null, plansUrl: plans }
      : null;
  const aiAvailable = aiOn(ctx.workspace);
  const aiSettings = ctx.workspace.settings.ai;
  let keyHint: string | null = null;
  if (aiSettings?.key)
    try {
      keyHint = decryptSecret(aiSettings.key).slice(-4);
    } catch {}
  const ai =
    ctx.can("workspace.manage") && aiAvailable
      ? {
          slug: ctx.workspace.slug,
          available: aiAvailable,
          enabled: !!aiSettings?.enabled,
          model: aiSettings?.model ?? DEFAULT_AI_MODEL,
          models: AI_MODELS,
          keyHint,
          instanceKey: instanceAiKey(),
          canEncrypt: canEncrypt(),
          plansUrl: plans,
        }
      : null;
  const trackersAvailable = trackersOn(ctx.workspace);
  const trackers =
    canConnect && trackersAvailable
      ? {
          slug: ctx.workspace.slug,
          trackers: trackersAvailable ? await listTrackers(ctx) : [],
          available: trackersAvailable,
          plansUrl: plans,
        }
      : null;
  const wikisAvailable = wikisOn(ctx.workspace);
  const wikis =
    canConnect && wikisAvailable ? { slug: ctx.workspace.slug, wikis: await listWikis(ctx), available: true, plansUrl: plans } : null;
  const videoAvailable = videoLinksOn(ctx.workspace);
  // BigBlueButton servers in every edition; Zoom, Meet and Teams accounts with the plan
  const videoAccounts = canConnect
    ? {
        slug: ctx.workspace.slug,
        accounts: await listVideoAccounts(ctx.db, ctx.workspace),
        available: videoAvailable,
        plansUrl: plans,
      }
    : null;
  const calendarAvailable = calendarSyncOn(ctx.workspace);
  const calendarAccounts =
    canConnect && calendarAvailable
      ? {
          slug: ctx.workspace.slug,
          accounts: calendarAvailable ? await listCalendarAccounts(ctx.db) : [],
          available: calendarAvailable,
          plansUrl: plans,
        }
      : null;
  // Slack: shown with its plan to the administrators who see the suggestions, even before it is in the plan. A
  // self-hosted instance without its Slack app says how to create it; the cloud just leaves it out meanwhile.
  const slackAvailable = slackOn(ctx.workspace);
  const slackState = slackView(ctx.workspace.settings);
  const locale = resolveLocale(ctx.user.locale, ctx.workspace.locale);
  const slack =
    canConnect && (slackAvailable || plans) && (slackState.configured || !isCloud())
      ? {
          slug: ctx.workspace.slug,
          available: slackAvailable,
          plansUrl: plans,
          setupUrl: `${env.siteUrl()}/${locale}/docs/self-hosting#slack`,
          ...slackState,
        }
      : null;
  // Microsoft Teams: the same as Slack
  const teamsAvailable = teamsOn(ctx.workspace);
  const teamsState = teamsView(ctx.workspace.settings);
  const teams =
    canConnect && (teamsAvailable || plans) && (teamsState.configured || !isCloud())
      ? {
          slug: ctx.workspace.slug,
          available: teamsAvailable,
          plansUrl: plans,
          setupUrl: `${env.siteUrl()}/${locale}/docs/self-hosting#microsoft-teams`,
          ...teamsState,
        }
      : null;
  const sttAvailable = transcriptionOn(ctx.workspace);
  const stt = ctx.workspace.settings.transcription;
  let sttKeyHint: string | null = null;
  if (stt?.key)
    try {
      sttKeyHint = decryptSecret(stt.key).slice(-4);
    } catch {}
  const transcription =
    ctx.can("workspace.manage") && sttAvailable
      ? {
          slug: ctx.workspace.slug,
          available: sttAvailable,
          enabled: !!stt?.enabled,
          baseUrl: stt?.baseUrl ?? "",
          model: stt?.model ?? "",
          language: stt?.language ?? "",
          keyHint: sttKeyHint,
          instanceService: !!(env.transcriptionKey() || env.transcriptionUrl()),
          canEncrypt: canEncrypt(),
          plansUrl: plans,
        }
      : null;
  return (
    <WorkspaceSettingsView
      workspace={{
        slug: ctx.workspace.slug,
        name: ctx.workspace.name,
        locale: ctx.workspace.locale,
        timezone: ctx.workspace.timezone,
        meetingCreation: ctx.workspace.settings.meetingCreation ?? "members",
        bufferMin: ctx.workspace.settings.bufferMin ?? 0,
        holidays: ctx.workspace.settings.holidays ?? "",
      }}
      holidayCalendars={{
        countries: holidayCountries(),
        regions: holidayRegions((ctx.workspace.settings.holidays ?? "").split("-")[0]!),
      }}
      urlPrefix={await publicUrl("/w/")}
      categories={categories}
      canManage={ctx.can("workspace.manage")}
      canDelete={ctx.can("workspace.delete")}
      connectors={canConnect ? await listConnectors(ctx) : null}
      phoneOn={featureOn("integrations.sms", ctx.workspace)}
      canEncrypt={canEncrypt()}
      branding={branding}
      ai={ai}
      trackers={trackers}
      wikis={wikis}
      videoAccounts={videoAccounts}
      calendarAccounts={calendarAccounts}
      transcription={transcription}
      slack={slack}
      teams={teams}
    />
  );
}
