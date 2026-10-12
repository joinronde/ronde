import "server-only";
import { isRealDate, occurrences } from "@ronde/core/schedule";
import { z } from "zod";
import { AccessError, OpError } from "../../errors";
import { isHolidayCode, NO_HOLIDAYS } from "../../holidays";
import { loadSchedule, resyncSession, timeZoneOf } from "../schedule";
import { defineOp, type OpContext } from "./define";

// Recurrence of a meeting (rules, exceptions per occurrence) and attendance answers

const isoDate = z.string().refine(isRealDate, "Invalid date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time");
const key = z
  .string()
  .regex(/^[\w-]{1,60}:\d{4}-\d{2}-\d{2}$/, "Invalid occurrence")
  .refine((k) => isRealDate(k.slice(-10)), "Invalid occurrence");

const RuleInput = z
  .object({
    /** Missing for a new rule */
    id: z.string().max(60).optional(),
    freq: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(99),
    byDay: z.array(z.number().int().min(1).max(7)).max(7),
    setPos: z
      .number()
      .int()
      .min(-1)
      .max(4)
      .refine((n) => n !== 0, "Invalid position")
      .nullable(),
    /** 1 to 31, or -1 for the last day of the month */
    monthDay: z
      .number()
      .int()
      .min(-1)
      .max(31)
      .refine((d) => d !== 0)
      .nullable(),
    startDate: isoDate,
    until: isoDate.nullable(),
    count: z.number().int().min(1).max(500).nullable(),
    time: hhmm,
    durationMin: z.number().int().min(5).max(480),
  })
  .refine((r) => r.freq !== "weekly" || r.byDay.length > 0, "Pick at least one day")
  .refine((r) => r.freq !== "monthly" || (r.setPos ? r.byDay.length === 1 : !!r.monthDay), "Pick a day of the month")
  .refine((r) => !r.until || r.until >= r.startDate, "The end date comes before the start");

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const splitKey = (k: string) => {
  const sep = k.lastIndexOf(":");
  return { ruleId: k.slice(0, sep), originalDate: k.slice(sep + 1) };
};

/** The rule of an occurrence key must belong to this meeting */
async function ruleOf(ctx: OpContext, occurrence: string) {
  const { ruleId, originalDate } = splitKey(occurrence);
  const rule = await ctx.db.scheduleRule.findFirst({ where: { id: ruleId, meetingId: ctx.meetingId } });
  if (!rule) throw new OpError("notFound");
  return { rule, originalDate };
}

const resync = (ctx: OpContext) => resyncSession(ctx.db, ctx.m.meeting, ctx.m.ws.workspace);

export const scheduleOps = [
  defineOp({
    name: "schedule.save",
    permission: "meeting.configure",
    input: z.object({ timeZone: z.string().max(60), rules: z.array(RuleInput).max(8) }),
    run: async (ctx, o) => {
      const { db, meetingId, workspaceId } = ctx;
      if (o.timeZone && !isTimeZone(o.timeZone)) throw new OpError("invalidRequest", { details: "timeZone" });
      // A meeting holds one session a day: rules meeting on the same day could never both be held
      const from = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + 366 * 86_400_000).toISOString().slice(0, 10);
      const dates = occurrences(
        o.rules.map((r, i) => ({ ...r, id: r.id ?? `new-${i}` })),
        [],
        o.timeZone || "UTC",
        { from, to },
      ).map((x) => x.date);
      if (new Set(dates).size !== dates.length) throw new OpError("scheduleSameDay");
      await db.meeting.update({ where: { id: meetingId }, data: { timezone: o.timeZone || null } });
      ctx.m.meeting.timezone = o.timeZone || null;
      const existing = await db.scheduleRule.findMany({ where: { meetingId }, select: { id: true } });
      const keep: string[] = [];
      for (const [position, { id, ...r }] of o.rules.entries()) {
        const data = { ...r, byDay: [...new Set(r.byDay)].sort(), position };
        if (id && existing.some((e) => e.id === id)) {
          await db.scheduleRule.update({ where: { id }, data });
          keep.push(id);
        } else keep.push((await db.scheduleRule.create({ data: { ...data, workspaceId, meetingId } })).id);
      }
      // Removed rules take their exceptions with them
      await db.scheduleRule.deleteMany({ where: { meetingId, id: { notIn: keep } } });
      await resync(ctx);
    },
  }),
  defineOp({
    name: "schedule.skip",
    permission: "session.run",
    input: z.object({ key }),
    run: async (ctx, o) => {
      const { rule, originalDate } = await ruleOf(ctx, o.key);
      const started = await ctx.db.session.findFirst({
        where: { meetingId: ctx.meetingId, occurrenceKey: o.key, startedAt: { not: null } },
      });
      if (started) throw new OpError("sessionAlreadyStarted");
      await ctx.db.scheduleException.upsert({
        where: { ruleId_originalDate: { ruleId: rule.id, originalDate } },
        create: { workspaceId: ctx.workspaceId, meetingId: ctx.meetingId, ruleId: rule.id, originalDate, kind: "cancel" },
        update: { kind: "cancel", date: null, time: null, durationMin: null },
      });
      await resync(ctx);
    },
  }),
  defineOp({
    name: "schedule.move",
    permission: "session.run",
    input: z.object({ key, date: isoDate.nullable(), time: hhmm.nullable(), durationMin: z.number().int().min(5).max(480).nullable() }),
    run: async (ctx, o) => {
      const { rule, originalDate } = await ruleOf(ctx, o.key);
      const { db, meetingId } = ctx;
      // Another occurrence or session already on that date: refused, two sessions cannot share a date
      if (o.date && o.date !== originalDate) {
        const tz = timeZoneOf(ctx.m.meeting, ctx.m.ws.workspace);
        const { rules, exceptions } = await loadSchedule(db, meetingId);
        const taken = occurrences(rules, exceptions, tz, { from: o.date, to: o.date }).some((x) => x.key !== o.key);
        const session = await db.session.findFirst({
          where: { meetingId, date: o.date, NOT: { occurrenceKey: o.key } },
          select: { id: true },
        });
        if (taken || session) throw new OpError("meetingDateTaken");
      }
      const data = {
        kind: "move" as const,
        date: o.date && o.date !== originalDate ? o.date : null,
        time: o.time && o.time !== rule.time ? o.time : null,
        durationMin: o.durationMin && o.durationMin !== rule.durationMin ? o.durationMin : null,
      };
      // Back to the rule's own date and time: no exception left
      if (!data.date && !data.time && !data.durationMin)
        await db.scheduleException.deleteMany({ where: { ruleId: rule.id, originalDate } });
      else
        await db.scheduleException.upsert({
          where: { ruleId_originalDate: { ruleId: rule.id, originalDate } },
          create: { workspaceId: ctx.workspaceId, meetingId, ruleId: rule.id, originalDate, ...data },
          update: data,
        });
      await resync(ctx);
    },
  }),
  defineOp({
    name: "schedule.keep",
    permission: "session.run",
    input: z.object({ key }),
    // Held although a public holiday would skip it (restore lets the holiday skip it again)
    run: async (ctx, o) => {
      const { rule, originalDate } = await ruleOf(ctx, o.key);
      await ctx.db.scheduleException.upsert({
        where: { ruleId_originalDate: { ruleId: rule.id, originalDate } },
        create: { workspaceId: ctx.workspaceId, meetingId: ctx.meetingId, ruleId: rule.id, originalDate, kind: "keep" },
        update: { kind: "keep", date: null, time: null, durationMin: null },
      });
      await resync(ctx);
    },
  }),
  defineOp({
    name: "schedule.holidays",
    permission: "meeting.configure",
    // null: the workspace's choice; "none": no holiday skipped; otherwise a country or a region ("FR", "DE-BY")
    input: z.object({ value: z.string().max(12).nullable() }),
    run: async (ctx, o) => {
      if (o.value !== null && o.value !== NO_HOLIDAYS && !isHolidayCode(o.value))
        throw new OpError("invalidRequest", { details: "holidays" });
      await ctx.db.meeting.update({ where: { id: ctx.meetingId }, data: { holidays: o.value } });
      ctx.m.meeting.holidays = o.value;
      await resync(ctx);
    },
  }),
  defineOp({
    name: "schedule.restore",
    permission: "session.run",
    input: z.object({ key }),
    run: async (ctx, o) => {
      const { rule, originalDate } = await ruleOf(ctx, o.key);
      await ctx.db.scheduleException.deleteMany({ where: { ruleId: rule.id, originalDate } });
      await resync(ctx);
    },
  }),
  defineOp({
    name: "attendance.set",
    permission: "session.participate",
    session: "read",
    input: z.object({ key, status: z.enum(["yes", "no"]).nullable(), personId: z.string().max(50).optional() }),
    run: async (ctx, o) => {
      const { db, m, meetingId, workspaceId, session } = ctx;
      const personId = o.personId ?? m.viewer.memberId;
      if (!personId) throw new OpError("notAMember");
      // Each person answers for themselves; the host can answer for someone (holidays known in advance)
      if (personId !== m.viewer.memberId && !m.can("session.run")) throw new AccessError(403, "accessDenied");
      if (!(await db.meetingParticipant.findFirst({ where: { meetingId, personId }, select: { id: true } })))
        throw new OpError("unknownMember");
      await ruleOf(ctx, o.key);
      const id = { meetingId_occurrenceKey_personId: { meetingId, occurrenceKey: o.key, personId } };
      if (o.status === null) await db.attendance.deleteMany({ where: { meetingId, occurrenceKey: o.key, personId } });
      else
        await db.attendance.upsert({
          where: id,
          create: { workspaceId, meetingId, occurrenceKey: o.key, personId, status: o.status },
          update: { status: o.status },
        });
      // The session of that occurrence, not started yet: absences follow the answers
      if (session && session.occurrenceKey === o.key && !session.startedAt) {
        const absent = new Set(session.absent);
        if (o.status === "no") absent.add(personId);
        else absent.delete(personId);
        await db.session.update({ where: { id: session.id }, data: { absent: [...absent] } });
      }
    },
  }),
];
