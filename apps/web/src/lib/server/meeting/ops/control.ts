import "server-only";
import { elapsedOf } from "@ronde/core/meeting";
import { MINUTES_PARTS } from "@ronde/core/record";
import { isRealDate, localDate, localTime, zonedInstant } from "@ronde/core/schedule";
import type { MeetingDTO } from "@ronde/core/types";
import { Prisma } from "@ronde/db";
import { z } from "zod";
import { awayPeople } from "../../absences";
import { AccessError, OpError } from "../../errors";
import { deliver, meetingPeople } from "../../inbox";
import { minutesPayload, notifyEvent, sessionPayload } from "../../notify/dispatch";
import { publishSession } from "../../wikis";
import { afterPublish } from "../async";
import { toMeeting } from "../dto";
import { moduleStates } from "../modules";
import { openSession, timeZoneOf } from "../schedule";
import { agendaFor, archiveSession, goToKey, sessionData } from "../session";
import { pushTurns } from "../turn-push";
import { defineOp, type OpContext } from "./define";

// Control room: running the session. Host and co-hosts only.

const str = (max = 500) => z.string().trim().max(max);
const isoDate = z.string().refine(isRealDate, "Invalid date");
const qaKeyOf = (k: string) => `qa:${k}`;

/** A session starts: the team is told through the notification rules and the bell */
async function announceStart(
  { db, after, m, meetingId, workspaceId }: Pick<OpContext, "db" | "after" | "m" | "meetingId" | "workspaceId">,
  s: { id: string; date: string; time: string },
) {
  after(() => notifyEvent(m.meeting.id, "session.started", `${s.id}@${s.date}`, sessionPayload(s)));
  await deliver(db, workspaceId, {
    to: await meetingPeople(db, meetingId),
    kind: "session.started",
    actorId: m.ws.member.personId,
    meetingId,
    href: `/m/${meetingId}/me`,
  });
}

export const controlOps = [
  defineOp({
    name: "meeting.create",
    permission: "session.run",
    audit: true,
    input: z.object({ date: isoDate.optional() }),
    run: async ({ db, m }, o) => {
      if (await db.session.findFirst({ where: { meetingId: m.meeting.id, status: "current" }, select: { id: true } }))
        throw new OpError("meetingAlreadyCurrent");
      if (o.date && (await db.session.findFirst({ where: { meetingId: m.meeting.id, date: o.date }, select: { id: true } })))
        throw new OpError("meetingDateTaken");
      // Without a date: the next occurrence of the schedule
      if (!(await openSession(db, m.meeting, m.ws.workspace, { date: o.date }))) throw new OpError("noUpcomingDate");
    },
  }),
  defineOp({
    name: "meeting.setDate",
    permission: "session.run",
    session: "lock",
    input: z.object({ date: isoDate }),
    run: async ({ db, requireSession, meetingId, workspaceId, m }, o) => {
      const s = requireSession();
      if (o.date === s.date) return;
      if (await db.session.findFirst({ where: { meetingId, date: o.date }, select: { id: true } })) throw new OpError("meetingDateTaken");
      // The occurrence of the schedule is moved: the schedule, the calendar feed and reminders follow
      if (s.occurrenceKey) {
        const sep = s.occurrenceKey.lastIndexOf(":");
        const ruleId = s.occurrenceKey.slice(0, sep);
        const originalDate = s.occurrenceKey.slice(sep + 1);
        if (await db.scheduleRule.findFirst({ where: { id: ruleId, meetingId }, select: { id: true } }))
          await db.scheduleException.upsert({
            where: { ruleId_originalDate: { ruleId, originalDate } },
            create: { workspaceId, meetingId, ruleId, originalDate, kind: "move", date: o.date === originalDate ? null : o.date },
            update: { kind: "move", date: o.date === originalDate ? null : o.date },
          });
      }
      const startsAt = new Date(zonedInstant(o.date, s.time, timeZoneOf(m.meeting, m.ws.workspace)));
      const away = await awayPeople(db, o.date, s.order);
      await db.session.update({ where: { id: s.id }, data: { date: o.date, startsAt, absent: [...new Set([...s.absent, ...away])] } });
      // Actions keep pointing at the session they came from
      await db.action.updateMany({ where: { meetingId, originDate: s.date }, data: { originDate: o.date } });
    },
  }),
  defineOp({
    name: "meeting.goto",
    permission: "session.run",
    session: "lock",
    input: z.object({ key: str(100) }),
    run: async ({ db, requireSession, m, after }, o) => {
      const s = requireSession();
      const moved = await goToKey(db, s, o.key, m.meeting.autoStart);
      if (moved) after(() => pushTurns(m, s, moved.agenda, moved.step));
    },
  }),
  defineOp({
    name: "meeting.step",
    permission: "session.run",
    session: "lock",
    // `from`: the step the person saw when pressing; a press made from a step already left (a double click, the
    // host and a co-host at once) moves nothing, instead of skipping someone
    input: z.object({ delta: z.union([z.literal(1), z.literal(-1)]), from: z.string().max(200).optional() }),
    run: async ({ db, requireSession, m, after }, o) => {
      const s = requireSession();
      if (o.from !== undefined && o.from !== s.stepKey) return;
      const agenda = await agendaFor(db, s);
      let i = agenda.findIndex((x) => x.key === s.stepKey);
      if (i < 0 && s.stepKey.startsWith("qa:")) i = agenda.findIndex((x) => x.key === s.stepKey.slice(3));
      const j = Math.max(0, Math.min(agenda.length - 1, Math.max(0, i) + o.delta));
      const moved = await goToKey(db, s, agenda[j]!.key, m.meeting.autoStart);
      if (moved) after(() => pushTurns(m, s, moved.agenda, moved.step));
    },
  }),
  defineOp({
    name: "meeting.togglePlay",
    permission: "session.run",
    session: "lock",
    input: z.object({}),
    run: async ({ db, requireSession, m, after, meetingId, workspaceId }) => {
      const s = requireSession();
      if (s.stepKey === "end") return;
      const dto = toMeeting(s);
      const now = Date.now();
      const el = elapsedOf(dto, now);
      const patch: Partial<MeetingDTO> = s.timerRunning
        ? { timer: { running: false, startedAt: null, baseMs: el } }
        : { timer: { running: true, startedAt: now, baseMs: el }, startedAt: dto.startedAt ?? now };
      await db.session.update({ where: { id: s.id }, data: sessionData(patch) });
      // "▶ Start the meeting": announced through the notification rules, without making the control room wait
      if (!dto.startedAt) await announceStart({ db, after, m, meetingId, workspaceId }, s);
    },
  }),
  defineOp({
    name: "session.now",
    permission: "session.run",
    audit: true,
    input: z.object({}),
    run: async (ctx) => {
      const { db, m, meetingId } = ctx;
      const timeZone = timeZoneOf(m.meeting, m.ws.workspace);
      const now = Date.now();
      const today = localDate(now, timeZone);
      const time = localTime(now, timeZone);
      let s = await db.session.findFirst({ where: { meetingId, status: "current" } });
      if (s?.startedAt) return;
      const heldToday = await db.session.findFirst({
        where: { meetingId, date: today, ...(s ? { id: { not: s.id } } : {}) },
        select: { id: true },
      });
      if (heldToday) throw new OpError("sessionHeldToday");
      // The session being prepared happens now; the occurrence it came from stays in the schedule for later
      if (s) {
        const away = await awayPeople(db, today, s.order);
        s = await db.session.update({
          where: { id: s.id },
          data: { date: today, time, startsAt: new Date(now), occurrenceKey: null, absent: [...new Set([...s.absent, ...away])] },
        });
      } else {
        s = await openSession(db, m.meeting, m.ws.workspace, { date: today });
        if (!s) throw new OpError("noUpcomingDate");
        s = await db.session.update({ where: { id: s.id }, data: { time, startsAt: new Date(now) } });
      }
      const dto = toMeeting(s);
      await db.session.update({
        where: { id: s.id },
        data: sessionData({ timer: { running: true, startedAt: now, baseMs: elapsedOf(dto, now) }, startedAt: now }),
      });
      await announceStart(ctx, s);
    },
  }),
  defineOp({
    name: "meeting.resetTimer",
    permission: "session.run",
    session: "lock",
    input: z.object({}),
    run: async ({ db, requireSession }) => {
      const s = requireSession();
      await db.session.update({
        where: { id: s.id },
        data: sessionData({ timer: { running: s.timerRunning, startedAt: s.timerRunning ? Date.now() : null, baseMs: 0 } }),
      });
    },
  }),
  defineOp({
    name: "meeting.reset",
    permission: "session.run",
    audit: true,
    session: "lock",
    input: z.object({}),
    // Back to the waiting screen (started by mistake, rehearsal): erase what happened during the session,
    // keep the check-ins, the host notes, the mood and the icebreaker
    run: async ({ db, requireSession }) => {
      const s = requireSession();
      await db.interaction.deleteMany({ where: { sessionId: s.id } });
      await db.reaction.deleteMany({ where: { sessionId: s.id } });
      await db.kudo.deleteMany({ where: { sessionId: s.id } });
      await db.session.update({
        where: { id: s.id },
        data: {
          ...sessionData({
            stepKey: "intro",
            spent: {},
            bonus: {},
            timer: { running: false, startedAt: null, baseMs: 0 },
            startedAt: null,
            endedAt: null,
          }),
          spotlight: Prisma.DbNull,
        },
      });
    },
  }),
  defineOp({
    name: "meeting.bonus",
    permission: "session.run",
    session: "lock",
    input: z.object({}),
    run: async ({ db, requireSession }) => {
      const s = requireSession();
      const bonus = toMeeting(s).bonus;
      bonus[s.stepKey] = (bonus[s.stepKey] ?? 0) + 30_000;
      await db.session.update({ where: { id: s.id }, data: { bonus } });
    },
  }),
  defineOp({
    name: "meeting.move",
    permission: "session.run",
    session: "lock",
    input: z.object({ id: str(50), delta: z.union([z.literal(1), z.literal(-1)]) }),
    run: async ({ db, requireSession }, o) => {
      const s = requireSession();
      const order = [...s.order];
      const i = order.indexOf(o.id);
      const j = i + o.delta;
      if (i < 0 || j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j]!, order[i]!];
      await db.session.update({ where: { id: s.id }, data: { order } });
    },
  }),
  defineOp({
    name: "meeting.shuffle",
    permission: "session.run",
    session: "lock",
    input: z.object({}),
    run: async ({ db, requireSession }) => {
      const s = requireSession();
      const agenda = await agendaFor(db, s);
      const cur = Math.max(
        0,
        agenda.findIndex((x) => x.key === s.stepKey),
      );
      const passed = new Set(agenda.slice(0, cur + 1).map((x) => x.key));
      const fixed = s.order.filter((id) => passed.has(id));
      const rest = s.order.filter((id) => !passed.has(id));
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j]!, rest[i]!];
      }
      await db.session.update({ where: { id: s.id }, data: { order: [...fixed, ...rest] } });
    },
  }),
  defineOp({
    name: "meeting.absent",
    permission: "session.run",
    session: "lock",
    input: z.object({ id: str(50) }),
    run: async ({ db, requireSession, m, meetingId }, o) => {
      const s = requireSession();
      if (!(await db.meetingParticipant.findFirst({ where: { meetingId, personId: o.id }, select: { id: true } })))
        throw new OpError("unknownMember");
      const absent = new Set(s.absent);
      const becomesAbsent = !absent.has(o.id);
      if (becomesAbsent) absent.add(o.id);
      else absent.delete(o.id);
      if (becomesAbsent && s.stepKey === o.id) {
        // The person currently speaking is absent: move on
        const agenda = await agendaFor(db, s);
        const i = agenda.findIndex((x) => x.key === o.id);
        const next = agenda.slice(i + 1).find((x) => x.key !== qaKeyOf(o.id));
        if (next) await goToKey(db, s, next.key, m.meeting.autoStart);
      }
      await db.session.update({ where: { id: s.id }, data: { absent: [...absent] } });
    },
  }),
  defineOp({
    name: "meeting.archive",
    permission: "session.run",
    audit: true,
    session: "lock",
    input: z.object({ summary: z.string().max(50_000).nullable().default(null), omit: z.array(z.enum(MINUTES_PARTS)).default([]) }),
    run: async ({ db, requireSession, m, emit, after, meetingId, workspaceId }, o) => {
      const s = requireSession();
      if (s.stepKey !== "end") throw new OpError("endBeforeArchive");
      const record = await archiveSession(db, m, s, o);
      await deliver(db, workspaceId, {
        to: await meetingPeople(db, meetingId),
        kind: "minutes.published",
        actorId: m.ws.member.personId,
        meetingId,
        href: `/m/${meetingId}/history`,
      });
      emit({ kind: "history" });
      after(() => notifyEvent(m.meeting.id, "minutes.published", s.id, minutesPayload(record, s)));
      // Its wiki gets the minutes as a page (Team)
      after(() => publishSession(s.id));
    },
  }),
  defineOp({
    name: "meeting.publish",
    permission: "session.run",
    audit: true,
    session: "lock",
    input: z.object({}),
    run: async ({ db, requireSession, m, meetingId, emit, after }) => {
      if (!(await moduleStates(db, meetingId)).async?.enabled) throw new AccessError(403, "moduleDisabled");
      const s = requireSession();
      // A session run live ends from the control room, with its minutes reviewed
      if (s.startedAt) throw new OpError("publishLive");
      const record = await archiveSession(db, m, s, { summary: null, omit: [] });
      emit({ kind: "history" });
      after(() => afterPublish(meetingId, s, record));
    },
  }),
  defineOp({
    name: "history.summary",
    permission: "minutes.edit",
    input: z.object({ date: isoDate, summary: z.string().max(50_000) }),
    run: async ({ db, meetingId, emit, after }, o) => {
      const s = await db.session.findFirst({ where: { meetingId, date: o.date, status: "archived" }, select: { id: true } });
      if (!s) throw new OpError("notFound");
      await db.session.update({ where: { id: s.id }, data: { summary: o.summary.trim() || null } });
      emit({ kind: "history" });
      // A page already in the wiki follows the new summary
      after(() => publishSession(s.id, { onlyUpdate: true }));
    },
  }),
  defineOp({
    name: "note.set",
    permission: "session.run",
    session: "read",
    input: z.object({ key: str(100), text: z.string().max(20_000) }),
    run: async ({ db, requireSession, workspaceId }, o) => {
      const s = requireSession();
      await db.note.upsert({
        where: { sessionId_key: { sessionId: s.id, key: o.key } },
        create: { workspaceId, sessionId: s.id, key: o.key, text: o.text },
        update: { text: o.text },
      });
    },
  }),
];
