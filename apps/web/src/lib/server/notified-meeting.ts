import "server-only";
import type { SettingsDTO } from "@ronde/core/types";
import { type Meeting, prisma, scoped } from "@ronde/db";
import { type Locale, resolveLocale } from "@ronde/i18n";
import { env } from "./env";
import { toSettings } from "./meeting/dto";
import { moduleStatesFrom } from "./meeting/modules";
import { scheduleDTO } from "./meeting/schedule";

/** A meeting as background work sees it (reminders, room messages): no signed-in user, no request */
export interface NotifiedMeeting {
  meeting: Meeting;
  settings: SettingsDTO;
  locale: Locale;
  /** Time zone of the schedule: the meeting's, otherwise the workspace's */
  timezone: string;
  /** Public URL of the meeting (empty without APP_URL: links are then left out) */
  appUrl: string;
}

export async function notifiedMeeting(meetingId: string): Promise<NotifiedMeeting | null> {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, archivedAt: null, workspace: { deletedAt: null, suspendedAt: null } },
    include: {
      workspace: { select: { slug: true, locale: true, timezone: true } },
      sections: { orderBy: { position: "asc" } },
      modules: true,
    },
  });
  if (!meeting) return null;
  const { workspace, sections, modules, ...row } = meeting;
  const base = env.appUrl();
  const locale = resolveLocale(row.locale, workspace.locale);
  return {
    meeting: row,
    settings: toSettings(
      row,
      sections,
      workspace,
      [],
      moduleStatesFrom(modules),
      await scheduleDTO(scoped(prisma, row.workspaceId), row, workspace, locale),
    ),
    locale,
    timezone: row.timezone || workspace.timezone || "UTC",
    appUrl: base ? `${base}/w/${workspace.slug}/m/${row.id}` : "",
  };
}
