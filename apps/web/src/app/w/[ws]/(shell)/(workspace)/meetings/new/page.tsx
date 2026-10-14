import { localDate } from "@ronde/core/schedule";
import type { Locale } from "@ronde/i18n";
import { getLocale, getTranslations } from "next-intl/server";
import { NewMeetingWizard } from "@/components/workspace/new-meeting";
import { pageWorkspace } from "@/lib/server/authz";
import { personName } from "@/lib/server/meeting/dto";
import { ALL_MODULES, moduleAllowed } from "@/lib/server/meeting/modules";
import { blankSummary, listTemplates } from "@/lib/server/templates";

export async function generateMetadata() {
  const t = await getTranslations("meetings.wizard");
  return { title: `${t("title")} · Ronde` };
}

export default async function NewMeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const ctx = await pageWorkspace((await params).ws, "meeting.create");
  const locale = (await getLocale()) as Locale;
  const [people, templates, teams] = await Promise.all([
    ctx.db.person.findMany({
      where: { active: true, id: { not: ctx.member.personId } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        color: true,
        avatar: { select: { updatedAt: true } },
        jobCategoryId: true,
      },
    }),
    listTemplates(ctx, locale),
    ctx.db.jobCategory.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, color: true, icon: true, parentId: true },
    }),
  ]);
  return (
    <NewMeetingWizard
      slug={ctx.workspace.slug}
      people={people.map((p) => ({
        id: p.id,
        name: personName(p),
        email: p.email,
        color: p.color,
        avatar: p.avatar?.updatedAt.getTime() ?? null,
        teamId: p.jobCategoryId,
      }))}
      teams={teams}
      blank={blankSummary(locale)}
      canInvite={ctx.can("people.invite")}
      templates={templates}
      allowedModules={ALL_MODULES.filter(moduleAllowed).map((m) => m.id)}
      today={localDate(Date.now(), ctx.workspace.timezone)}
      timeZone={ctx.workspace.timezone}
      initial={(await searchParams).template}
    />
  );
}
