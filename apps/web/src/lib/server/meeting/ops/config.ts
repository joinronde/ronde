import { locales, resolveLocale } from "@ronde/i18n";
import { readConfig } from "@ronde/module-sdk";
import { icebreaker, pickIcebreaker } from "@ronde/modules";
import { removeMeetingEvents } from "../../calendars";
import "server-only";
import { randomBytes } from "node:crypto";
import { agendaSchema, BLOCK_MODULE } from "@ronde/core/agenda";
import { ACCENTS } from "@ronde/core/appearance";
import { sectionsProblem } from "@ronde/core/templates";
import { sectionBehavior } from "@ronde/core/util";
import { type Prisma, prisma } from "@ronde/db";
import { z } from "zod";
import { AccessError, OpError } from "../../errors";
import { deliver } from "../../inbox";
import { saveTemplate } from "../../templates";
import { saveCheckIn } from "../checkins";
import { toSection } from "../dto";
import { ALL_MODULES, defaultIcebreakerBank, defaultInstallations, moduleAllowed, moduleStates } from "../modules";
import { agendaFor, goToKey } from "../session";
import { sectionsOf } from "../state";
import { defineOp } from "./define";

// Check-ins, preferences, meeting settings, modules and participants

const str = (max = 500) => z.string().trim().max(max);
/** Items of a section; a free-text section has a single one, over several lines */
const list = z.array(str(2000)).max(50);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const _birthday = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Invalid date.")
  // 2000 is a leap year: February 29 is accepted, April 31 is not
  .refine((v) => new Date(2000, Number(v.slice(0, 2)) - 1, Number(v.slice(3))).getDate() === Number(v.slice(3)), "Invalid date.");

const SectionInput = z.object({
  /** Missing for a new section */
  key: z
    .string()
    .regex(/^[a-z0-9]{1,30}$/)
    .optional(),
  label: str(60),
  role: z.enum(["achievement", "plan", "blocker", "note", "custom"]),
  input: z.enum(["list", "checklist", "text"]),
  /** Achievement section in checklist form: last time's plans come back in it */
  carryPlans: z.boolean().optional(),
});

const newKey = () => randomBytes(4).toString("hex");

/** Items of a check-in, per kind of section */
const fieldsInput = {
  done: list,
  next: list,
  blockers: list,
  other: list,
  extra: z.record(z.string().max(30), list).default({}),
};

export const configOps = [
  defineOp({
    name: "checkIn.save",
    permission: "checkin.write.own",
    input: z.object({
      memberId: str(50),
      ...fieldsInput,
      /** Tabs of projects to save, by project id (projects left out keep their items) */
      byProject: z.record(z.string().max(50), z.object(fieldsInput)).optional(),
      /** Version of the check-in the draft started from (its last update; null: never saved) */
      since: z.number().nullable().optional(),
    }),
    run: async ({ db, m, meetingId, workspaceId }, o) => {
      // The host can fix someone's check-in when needed
      if (o.memberId !== m.viewer.memberId && !m.can("checkin.write.any")) throw new AccessError(403, "ownCheckInOnly");
      if (!(await db.meetingParticipant.findFirst({ where: { meetingId, personId: o.memberId }, select: { id: true } })))
        throw new OpError("unknownMember");
      // Saves of one check-in take turns until the transaction ends, a first save (no row yet) included
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`checkin:${meetingId}:${o.memberId}`}, 0))`;
      // Saved meanwhile elsewhere (the host fixing it, another tab): the page merges that version first
      if (o.since !== undefined) {
        const head = await db.checkIn.findFirst({ where: { meetingId, personId: o.memberId }, select: { updatedAt: true } });
        if ((head?.updatedAt.getTime() ?? null) !== o.since) throw new OpError("checkInChanged");
      }
      const sections = (await sectionsOf(db, meetingId)).map(toSection);
      const clean = (l: string[]) => l.filter(Boolean);
      const fields = (f: z.infer<z.ZodObject<typeof fieldsInput>>) => ({
        done: clean(f.done),
        next: clean(f.next),
        blockers: clean(f.blockers),
        other: clean(f.other),
        extra: Object.fromEntries(Object.entries(f.extra).map(([k, v]) => [k, clean(v)])),
      });
      // Only the projects the meeting follows have a tab
      const projectIds = Object.keys(o.byProject ?? {});
      if (projectIds.length) {
        const followed = await db.meetingProject.count({ where: { meetingId, projectId: { in: projectIds } } });
        if (followed !== projectIds.length) throw new OpError("notFound");
      }
      await saveCheckIn(
        db,
        { workspaceId, meetingId, personId: o.memberId },
        {
          ...fields(o),
          ...(o.byProject ? { byProject: Object.fromEntries(Object.entries(o.byProject).map(([p, f]) => [p, fields(f)])) } : {}),
        },
        sections,
      );
    },
  }),
  defineOp({
    name: "pref.set",
    permission: "meeting.read",
    input: z.object({ key: z.string().regex(/^[a-z][a-z0-9.:-]{0,60}$/), value: z.unknown().nullable() }),
    run: async ({ m, quiet }, o) => {
      quiet();
      const userId = m.viewer.userId;
      const value = o.value === undefined || o.value === null ? null : o.value;
      if (value !== null && JSON.stringify(value).length > 20_000) throw new OpError("prefTooLarge");
      // Preferences belong to the user, outside any workspace
      if (value === null) await prisma.userPref.deleteMany({ where: { userId, key: o.key } });
      else
        await prisma.userPref.upsert({
          where: { userId_key: { userId, key: o.key } },
          create: { userId, key: o.key, value: value as Prisma.InputJsonValue },
          update: { value: value as Prisma.InputJsonValue },
        });
    },
  }),
  defineOp({
    name: "settings.save",
    permission: "meeting.configure",
    input: z.object({
      teamName: str(100).min(1),
      /** Empty: the workspace language */
      locale: z.enum(["", ...locales]),
      hostLabel: str(50),
      speakSec: z.number().int().min(15).max(1800),
      autoStart: z.boolean(),
      targetMin: z.number().int().min(5).max(480),
      announcements: list,
      reminderEnabled: z.boolean(),
      reminderWhen: z.enum(["dayBefore", "sameDay"]),
      reminderTime: hhmm,
      sections: z.array(SectionInput).min(1).max(12),
      accent: z.enum(ACCENTS).optional(),
    }),
    run: async ({ db, meetingId, workspaceId, m }, o) => {
      const problem = sectionsProblem(o.sections);
      if (problem) throw new OpError(problem);
      const { sections, teamName, locale, accent, ...rest } = o;
      await db.meeting.update({
        where: { id: meetingId },
        data: {
          ...rest,
          name: teamName,
          locale: locale || null,
          announcements: rest.announcements.filter(Boolean),
          ...(accent ? { appearance: { accent } } : {}),
        },
      });
      // Sections: kept by key (their check-in items follow them), new ones get a key, missing ones go
      const keep = new Set<string>();
      for (const [position, s] of sections.entries()) {
        // A new section may come with the key its editor picked: it then stays the same from one save to the next
        const key = s.key && !keep.has(s.key) ? s.key : newKey();
        keep.add(key);
        const data = { label: s.label, role: s.role, input: s.input, behavior: sectionBehavior(s), position };
        await db.section.upsert({
          where: { meetingId_key: { meetingId, key } },
          create: { workspaceId, meetingId, key, ...data },
          update: data,
        });
      }
      await db.section.deleteMany({ where: { meetingId, key: { notIn: [...keep] } } });
      // Another language: the icebreaker's questions follow it, unless the host wrote their own
      const before = resolveLocale(m.meeting.locale, m.ws.workspace.locale);
      const after = resolveLocale(locale || null, m.ws.workspace.locale);
      if (before !== after) {
        const row = await db.moduleInstallation.findUnique({ where: { meetingId_moduleId: { meetingId, moduleId: "icebreaker" } } });
        const bank = row ? readConfig(icebreaker, row.config).bank : [];
        if (row && JSON.stringify(bank) === JSON.stringify(defaultIcebreakerBank(before)))
          await db.moduleInstallation.update({
            where: { meetingId_moduleId: { meetingId, moduleId: "icebreaker" } },
            data: { config: { ...(row.config as object), bank: defaultIcebreakerBank(after) } },
          });
      }
    },
  }),
  defineOp({
    name: "agenda.save",
    permission: "meeting.configure",
    input: z.object({ blocks: agendaSchema }),
    run: async ({ db, meetingId }, o) => {
      // Steps would move under the people following the session: the agenda changes between sessions
      if (
        await db.session.findFirst({
          where: { meetingId, status: "current", startedAt: { not: null }, endedAt: null },
          select: { id: true },
        })
      )
        throw new OpError("agendaLocked");
      const mods = await moduleStates(db, meetingId);
      for (const b of o.blocks) {
        const mod = BLOCK_MODULE[b.type];
        if (mod && !mods[mod]?.enabled) throw new OpError("agendaModuleOff", { module: mod });
      }
      await db.meeting.update({ where: { id: meetingId }, data: { agenda: o.blocks as unknown as Prisma.InputJsonArray } });
    },
  }),
  defineOp({
    name: "meeting.icon",
    permission: "meeting.configure",
    // An emoji (a short sequence: flags, skin tones, joined emojis), or empty for the initials
    input: z.object({ icon: z.string().max(32) }),
    run: async ({ db, meetingId, m }, o) => {
      const icon = o.icon.trim();
      if (icon && (!/^\p{Extended_Pictographic}|^\p{Regional_Indicator}/u.test(icon) || [...new Intl.Segmenter().segment(icon)].length > 1))
        throw new OpError("invalidRequest", { details: "icon" });
      await db.meeting.update({ where: { id: meetingId }, data: { icon } });
      m.meeting.icon = icon;
    },
  }),
  defineOp({
    name: "meeting.remove",
    permission: "meeting.delete",
    input: z.object({ confirm: str(100) }),
    // The meeting leaves the lists and its pages; its rows stay until the workspace is deleted
    run: async ({ db, meetingId, workspaceId, m, after }, o) => {
      if (o.confirm.trim() !== m.meeting.name.trim()) throw new OpError("confirmationMismatch");
      await db.meeting.update({ where: { id: meetingId }, data: { archivedAt: new Date() } });
      // Its coming sessions leave the calendars
      if (m.meeting.calendarAccountId) after(() => removeMeetingEvents(workspaceId, meetingId));
    },
  }),
  defineOp({
    name: "template.save",
    permission: "meeting.configure",
    input: z.object({ name: str(80).min(1), description: str(300).default(""), icon: str(16).default("") }),
    run: async ({ db, m, meetingId, workspaceId, quiet }, o) => {
      quiet();
      if (!m.can("templates.manage")) throw new AccessError(403, "accessDenied");
      await saveTemplate(db, { workspaceId, meetingId, userId: m.viewer.userId }, o);
    },
  }),
  defineOp({
    name: "modules.set",
    permission: "meeting.configure",
    input: z.object({ moduleId: str(40), enabled: z.boolean() }),
    run: async ({ db, meetingId, workspaceId, m }, o) => {
      const mod = ALL_MODULES.find((x) => x.id === o.moduleId);
      if (!mod) throw new OpError("notFound");
      if (!moduleAllowed(mod)) throw new AccessError(403, "moduleNotInEdition");
      // The icebreaker starts with the questions of a new meeting, in its language, when it has none yet
      const defaults =
        mod.id === "icebreaker"
          ? defaultInstallations(workspaceId, meetingId, resolveLocale(m.meeting.locale, m.ws.workspace.locale)).find(
              (x) => x.moduleId === "icebreaker",
            )!.config
          : (mod.config.defaults as object);
      const row = await db.moduleInstallation.upsert({
        where: { meetingId_moduleId: { meetingId, moduleId: mod.id } },
        create: { workspaceId, meetingId, moduleId: mod.id, enabled: o.enabled, config: defaults },
        update: { enabled: o.enabled },
      });
      if (mod.id !== "icebreaker" || !o.enabled) return;
      let bank = readConfig(icebreaker, row.config).bank.filter((q) => q.trim());
      if (!bank.length) {
        await db.moduleInstallation.update({ where: { meetingId_moduleId: { meetingId, moduleId: mod.id } }, data: { config: defaults } });
        bank = readConfig(icebreaker, defaults).bank;
      }
      // Turned on during a session: it gets its question now, not at the next one (in one statement, so a
      // question picked meanwhile is kept)
      await db.session.updateMany({
        where: { meetingId, status: "current", icebreaker: null, stepKey: { not: "end" } },
        data: { icebreaker: pickIcebreaker(bank) },
      });
    },
  }),
  defineOp({
    name: "participant.add",
    permission: "participants.manage",
    session: "read",
    input: z.object({ personId: str(50), role: z.enum(["host", "cohost", "participant", "observer"]).default("participant") }),
    run: async ({ db, session, meetingId, workspaceId, m }, o) => {
      const person = await db.person.findFirst({ where: { id: o.personId, active: true }, select: { id: true } });
      if (!person) throw new OpError("unknownMember");
      if (await db.meetingParticipant.findFirst({ where: { meetingId, personId: o.personId }, select: { id: true } }))
        throw new OpError("alreadyParticipant");
      const position = await db.meetingParticipant.count({ where: { meetingId } });
      await db.meetingParticipant.create({ data: { workspaceId, meetingId, personId: o.personId, role: o.role, position } });
      await deliver(db, workspaceId, {
        to: [o.personId],
        kind: "meeting.joined",
        actorId: m.ws.member.personId,
        meetingId,
        href: `/m/${meetingId}`,
      });
      // Joins the round table of the coming session
      if (session && o.role !== "observer" && !session.order.includes(o.personId))
        await db.session.update({ where: { id: session.id }, data: { order: [...session.order, o.personId] } });
    },
  }),
  defineOp({
    name: "participant.update",
    permission: "participants.manage",
    session: "lock",
    input: z.object({
      id: str(50),
      role: z.enum(["host", "cohost", "participant", "observer"]).optional(),
      active: z.boolean().optional(),
      remind: z.boolean().optional(),
      position: z.number().int().min(0).max(1000).optional(),
      gitlabUsername: str(100).nullable().optional(),
      githubUsername: str(100)
        .regex(/^[A-Za-z0-9-]*$/)
        .nullable()
        .optional(),
    }),
    run: async ({ db, session, meetingId, m }, o) => {
      const p = await db.meetingParticipant.findFirst({ where: { meetingId, personId: o.id }, include: { person: true } });
      if (!p) throw new OpError("unknownMember");
      if (
        o.role &&
        o.role !== "host" &&
        p.role === "host" &&
        (await db.meetingParticipant.count({ where: { meetingId, role: "host" } })) <= 1
      )
        throw new OpError("lastHost");
      // Made an observer during their turn: the session goes on to the next step
      if (o.role === "observer" && session) await leaveTurn(db, session, o.id, m.meeting.autoStart);
      const { gitlabUsername, githubUsername, id: _id, ...patch } = o;
      await db.meetingParticipant.update({ where: { id: p.id }, data: patch });
      if (gitlabUsername !== undefined || githubUsername !== undefined) {
        const handles = { ...((p.person.handles ?? {}) as Record<string, unknown>) };
        if (gitlabUsername !== undefined) handles.gitlab = gitlabUsername || undefined;
        if (githubUsername !== undefined) handles.github = githubUsername || undefined;
        await db.person.update({ where: { id: p.personId }, data: { handles: handles as Prisma.InputJsonObject } });
      }
      // Speaking in the round table, or not: applied to the session not started yet
      const speaks = (o.active ?? p.active) && (o.role ?? p.role) !== "observer";
      if (session && !session.startedAt) {
        const order = speaks
          ? session.order.includes(p.personId)
            ? session.order
            : [...session.order, p.personId]
          : session.order.filter((x) => x !== p.personId);
        await db.session.update({ where: { id: session.id }, data: { order } });
      }
    },
  }),
  defineOp({
    name: "participant.remove",
    permission: "participants.manage",
    session: "lock",
    input: z.object({ id: str(50) }),
    run: async ({ db, session, meetingId, m }, o) => {
      const p = await db.meetingParticipant.findFirst({ where: { meetingId, personId: o.id } });
      if (!p) return;
      if (p.role === "host" && (await db.meetingParticipant.count({ where: { meetingId, role: "host" } })) <= 1)
        throw new OpError("lastHost");
      // Removed during their turn: the session goes on to the next step, not back to the first speaker
      if (session) await leaveTurn(db, session, o.id, m.meeting.autoStart);
      await db.meetingParticipant.delete({ where: { id: p.id } });
      if (session)
        await db.session.update({
          where: { id: session.id },
          data: { order: session.order.filter((x) => x !== o.id), absent: session.absent.filter((x) => x !== o.id) },
        });
    },
  }),
];

/** Someone whose turn it is leaves the round (removed, made an observer): the session moves to the next step */
async function leaveTurn(db: Parameters<typeof agendaFor>[0], s: Parameters<typeof agendaFor>[1], personId: string, autoStart: boolean) {
  if (s.stepKey !== personId) return;
  const agenda = await agendaFor(db, s);
  const i = agenda.findIndex((x) => x.key === personId);
  const to = agenda[i + 1] ?? agenda[i - 1];
  if (to) await goToKey(db, s, to.key, autoStart);
}
