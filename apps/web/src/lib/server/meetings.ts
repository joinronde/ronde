import "server-only";
import { withRoundsOrder } from "@ronde/core/agenda";
import { describeSchedule } from "@ronde/core/schedule";
import { sectionBehavior } from "@ronde/core/util";
import type { Prisma } from "@ronde/db";
import { type Locale, resolveLocale } from "@ronde/i18n";
import type { WorkspaceContext } from "./authz";
import { AccessError, OpError } from "./errors";
import { personName } from "./meeting/dto";
import { defaultInstallations } from "./meeting/modules";
import { openSession, timeZoneOf } from "./meeting/schedule";
import { installationsFrom, resolveTemplate, rulesFrom, templateIcon } from "./templates";

export interface MeetingSummary {
  id: string;
  name: string;
  role: "host" | "cohost" | "participant" | "observer" | null;
  participants: number;
  /** Date of the current session, and whether it is running */
  next: { date: string; live: boolean } | null;
  /** Recurrence in plain words, in the viewer's language */
  schedule: string;
  /** The sample meeting (lib/server/sample.ts) */
  sample: boolean;
  /** Its emoji, and the version of its uploaded image (null: none) */
  icon: string;
  image: number | null;
}

/** Meetings the user sees: those they take part in; owners and admins see every meeting of the workspace */
export async function listMeetings(ctx: WorkspaceContext, locale: Locale): Promise<MeetingSummary[]> {
  // Owners, admins and custom roles reading every meeting see them all; the others, the meetings they are in
  const seesAll = ctx.can("meeting.read");
  const rows = await ctx.db.meeting.findMany({
    where: { archivedAt: null, ...(seesAll ? {} : { participants: { some: { personId: ctx.member.personId } } }) },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      timezone: true,
      sample: true,
      icon: true,
      image: { select: { updatedAt: true } },
      rules: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      participants: { select: { personId: true, role: true } },
      sessions: { where: { status: "current" }, select: { date: true, startedAt: true, endedAt: true } },
    },
  });
  return rows.map((m) => {
    const session = m.sessions[0];
    return {
      id: m.id,
      name: m.name,
      role: m.participants.find((p) => p.personId === ctx.member.personId)?.role ?? null,
      participants: m.participants.filter((p) => p.role !== "observer").length,
      next: session ? { date: session.date, live: !!session.startedAt && !session.endedAt } : null,
      // In the reader's time zone, the zone goes without saying
      schedule: describeSchedule(m.rules, timeZoneOf(m, ctx.workspace), locale, ctx.user.timezone ?? ctx.workspace.timezone),
      sample: m.sample,
      icon: m.icon,
      image: m.image ? m.image.updatedAt.getTime() : null,
    };
  });
}

export interface NewMeeting {
  name: string;
  /** "builtin:<id>" or the id of a workspace template */
  template: string;
  /** First possible date, YYYY-MM-DD */
  startDate: string;
  /** Time and duration of the first schedule pattern */
  time: string;
  durationMin: number;
  /** Day of a weekly pattern on a single day (1 = Monday); null keeps the template's */
  weekday: number | null;
  /** People invited to take part, besides the creator (who becomes host) */
  personIds: string[];
  /** Whether the creator takes a turn in the round table */
  creatorSpeaks: boolean;
  /** Modules turned on or off over the template's choice */
  modules: Record<string, boolean>;
  /** With a round table and a project round: which one comes first (null or missing: the template's order) */
  first?: "team" | "projects" | null;
}

/** Creates a meeting from a template: its sections, format, modules and schedule, its people, its first session */
export async function createMeeting(ctx: WorkspaceContext, input: NewMeeting): Promise<{ id: string }> {
  if (!ctx.can("meeting.create")) throw new AccessError(403, "accessDenied");
  const name = input.name.trim();
  if (!name) throw new OpError("nameRequired");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ||
    !/^\d{2}:\d{2}$/.test(input.time) ||
    !(input.durationMin >= 5 && input.durationMin <= 480) ||
    (input.weekday !== null && !(input.weekday >= 1 && input.weekday <= 7))
  )
    throw new OpError("invalidRequest", { details: "schedule" });
  const locale = resolveLocale(ctx.workspace.locale);
  const template = await resolveTemplate(ctx, input.template, locale);
  // The template's emoji marks the meeting in the menus (changed or replaced by an image in its settings)
  const icon = await templateIcon(ctx, input.template);
  const others = [...new Set(input.personIds)].filter((id) => id !== ctx.member.personId);
  const found = await ctx.db.person.findMany({
    where: { id: { in: others }, active: true },
    select: { id: true, firstName: true, lastName: true },
  });
  if (found.length !== others.length) throw new OpError("unknownMember");
  // People sorted by name for a stable round table
  const people = found.sort((a, b) => personName(a).localeCompare(personName(b)));
  const workspaceId = ctx.workspace.id;
  // The first pattern takes the time, duration and day picked; the others keep their time (a handover in the
  // morning and in the evening) and take the same duration
  const patterns = template.schedule.map((p, i) =>
    i
      ? { ...p, durationMin: input.durationMin }
      : {
          ...p,
          time: input.time,
          durationMin: input.durationMin,
          byDay: p.freq === "weekly" && p.byDay.length <= 1 && input.weekday ? [input.weekday] : p.byDay,
        },
  );

  return ctx.db.$transaction(async (tx) => {
    const { settings } = template;
    const meeting = await tx.meeting.create({
      data: {
        workspaceId,
        name,
        icon,
        createdById: ctx.user.id,
        ...settings,
        ...(template.agenda
          ? {
              agenda: (input.first === "team" || input.first === "projects"
                ? withRoundsOrder(template.agenda, input.first)
                : template.agenda) as unknown as Prisma.InputJsonArray,
            }
          : {}),
      },
    });
    await tx.scheduleRule.createMany({
      data: rulesFrom(patterns, input.startDate).map(({ id: _id, ...r }, position) => ({
        ...r,
        workspaceId,
        meetingId: meeting.id,
        position,
      })),
    });
    await tx.moduleInstallation.createMany({
      data: installationsFrom(template, defaultInstallations(workspaceId, meeting.id, locale), input.modules),
    });
    await tx.section.createMany({
      data: template.sections.map((s, position) => ({
        workspaceId,
        meetingId: meeting.id,
        key: s.key,
        label: s.label,
        role: s.role,
        input: s.input,
        behavior: sectionBehavior(s),
        position,
      })),
    });
    await tx.meetingParticipant.createMany({
      data: [
        {
          workspaceId,
          meetingId: meeting.id,
          personId: ctx.member.personId,
          role: "host" as const,
          position: 0,
          active: input.creatorSpeaks,
        },
        ...people.map((p, i) => ({ workspaceId, meetingId: meeting.id, personId: p.id, role: "participant" as const, position: i + 1 })),
      ],
    });
    await openSession(tx, meeting, ctx.workspace);
    return { id: meeting.id };
  });
}
