import { localDate } from "@ronde/core/schedule";
import { splitName } from "@ronde/core/slug";
import { TEMPLATE_ICONS } from "@ronde/core/templates";
import { prisma } from "@ronde/db";
import type { Locale } from "@ronde/i18n";
import { roundTableFaces } from "@ronde/ui/faces";
import { getLocale, getTranslations } from "next-intl/server";
import { Dashboard } from "@/components/workspace/dashboard";
import { pageWorkspace } from "@/lib/server/authz";
import { dashboard } from "@/lib/server/dashboard";
import { listMeetings } from "@/lib/server/meetings";
import { firstStepsHidden } from "@/lib/shared/prefs";

export async function generateMetadata({ params }: { params: Promise<{ ws: string }> }) {
  const ctx = await pageWorkspace((await params).ws);
  return { title: `${ctx.workspace.name} · Ronde` };
}

export default async function WorkspaceHome({ params }: { params: Promise<{ ws: string }> }) {
  const ctx = await pageWorkspace((await params).ws);
  const t = await getTranslations("workspace.home");
  const tt = await getTranslations("templates");
  const base = `/w/${ctx.workspace.slug}`;
  // Skipped by the person: the first steps no longer show on this workspace's home page
  const stepsHidden = !!(await prisma.userPref.findUnique({
    where: { userId_key: { userId: ctx.user.id, key: firstStepsHidden(ctx.workspace.id) } },
    select: { userId: true },
  }));
  // The first steps are the team's own: the sample meeting and its fictitious team do not tick any of them
  const [meetings, people, myItems, ran, data, speaking] = await Promise.all([
    listMeetings(ctx, (await getLocale()) as Locale),
    ctx.db.person.count({ where: { sample: false } }),
    ctx.db.checkInItem.count({ where: { personId: ctx.member.personId, meeting: { sample: false } } }),
    ctx.db.session.count({
      where: {
        status: "archived",
        meeting: {
          archivedAt: null,
          sample: false,
          participants: { some: { personId: ctx.member.personId, role: { in: ["host", "cohost"] } } },
        },
      },
    }),
    dashboard(ctx),
    // Meetings where the person speaks: a host who only runs one has no check-in to write
    ctx.db.meetingParticipant.findMany({
      where: { personId: ctx.member.personId, active: true, role: { not: "observer" } },
      select: { meetingId: true },
    }),
  ]);
  const real = meetings.filter((m) => !m.sample);
  // Where to go for the next steps: a meeting the person takes part in, one they run
  const joined = real.find((m) => speaking.some((p) => p.meetingId === m.id));
  const hosted = real.find((m) => m.role === "host" || m.role === "cohost");
  const manager = ctx.can("people.invite");
  const canCreate = ctx.can("meeting.create");
  // The first steps, in the order that gets a team going, and always the same ones (a list that grows as
  // they are done reads like going backwards). The profile and the job categories are settings, not steps.
  const steps = [
    ...(canCreate
      ? [{ key: "meeting", done: real.length > 0, title: t("stepMeeting"), hint: t("stepMeetingHint"), href: `${base}/meetings/new` }]
      : []),
    ...(manager
      ? [
          {
            key: "invite",
            done: people > 1,
            title: t("stepInvite"),
            hint: t("stepInviteHint", { count: people - 1 }),
            href: `${base}/people?invite=1`,
          },
        ]
      : []),
    ...(canCreate || joined
      ? [
          {
            key: "checkIn",
            done: myItems > 0,
            title: t("stepCheckIn"),
            hint: t("stepCheckInHint"),
            href: joined ? `${base}/m/${joined.id}/me` : `${base}/meetings/new`,
          },
        ]
      : []),
    ...(canCreate || hosted
      ? [
          {
            key: "session",
            done: ran > 0,
            title: t("stepSession"),
            hint: t("stepSessionHint"),
            href: hosted ? `${base}/m/${hosted.id}/control` : `${base}/meetings/new`,
          },
        ]
      : []),
  ];
  // Greeting by the time of day where the person is
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: ctx.user.timezone ?? ctx.workspace.timezone }).format(
      new Date(),
    ),
  );
  const moment = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return (
    <Dashboard
      slug={ctx.workspace.slug}
      moment={moment}
      firstName={splitName(ctx.user.name)[0] || ctx.user.email}
      today={localDate(Date.now(), ctx.user.timezone ?? ctx.workspace.timezone)}
      data={data}
      meetings={meetings.map((m, color) => ({
        id: m.id,
        name: m.name,
        icon: m.icon,
        image: m.image,
        color,
        schedule: m.schedule,
        participants: m.participants,
        next: m.next,
        role: m.role,
      }))}
      steps={stepsHidden ? [] : steps}
      canCreate={canCreate}
      // The fictitious team of the sample meeting, for its card
      sampleFaces={roundTableFaces()
        .slice(0, 5)
        .map((f) => f.src)}
      // The usual ones, to start a first meeting in one click; the wizard has all of them
      starters={(["weekly", "standup", "retro", "oneOnOne"] as const).map((id) => ({
        ref: `builtin:${id}`,
        icon: TEMPLATE_ICONS[id],
        name: tt(`${id}.name`),
        description: tt(`${id}.description`),
      }))}
    />
  );
}
