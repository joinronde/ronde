import { baseKeyOf, projectOfKey } from "@ronde/core/meeting";
import { localDate } from "@ronde/core/schedule";
import "server-only";
import { LINE_REACTIONS } from "@ronde/core/types";
import { sectionKeyOf, VOTES_PER_PERSON } from "@ronde/core/util";
import type { ScopedTx } from "@ronde/db";
import { actorId, requireActor, requireParticipant, str } from "@ronde/modules/shared";
import { z } from "zod";
import { AccessError, OpError } from "../../errors";
import { deliver } from "../../inbox";
import { toSection } from "../dto";
import { timeZoneOf } from "../schedule";
import { defineOp } from "./define";

// What everyone does around a session: open topics and votes, comments on check-ins, follow-up actions.
// Raised hands, reactions, kudos, mood and the icebreaker are modules (@ronde/modules).
// Ids sent by the browser are always looked up within the meeting: an id from another meeting is "not found".

/** The item of a current check-in that a comment is about: screens name it by its field and its text */
export async function commentedItem(
  db: ScopedTx,
  meetingId: string,
  o: { ownerId: string; section: string; itemText: string; projectId?: string | null },
) {
  const sections = (await db.section.findMany({ where: { meetingId }, orderBy: { position: "asc" } })).map(toSection);
  const sectionKey = sectionKeyOf(sections, o.section);
  const item = sectionKey
    ? await db.checkInItem.findFirst({
        where: {
          meetingId,
          personId: o.ownerId,
          sessionId: null,
          sectionKey,
          text: o.itemText,
          ...(o.projectId !== undefined ? { projectId: o.projectId } : {}),
        },
      })
    : null;
  if (!item) throw new OpError("notFound");
  return item;
}

/**
 * The day an action was decided: its session's, once that session has started (whatever day it is dated); before
 * it starts, today when it is still to come; today too when there is no session (an action one gives oneself)
 */
function decidedOn(session: { date: string; startedAt: Date | null } | null, timeZone: string): string {
  const today = localDate(Date.now(), timeZone);
  if (!session) return today;
  if (session.startedAt) return session.date;
  return session.date < today ? session.date : today;
}

export const liveOps = [
  defineOp({
    name: "topic.add",
    permission: "session.participate",
    input: z.object({ text: str(300).min(1) }),
    run: async ({ db, m, meetingId, workspaceId }, o) => {
      await db.topic.create({ data: { workspaceId, meetingId, text: o.text, byId: actorId(m.viewer) } });
    },
  }),
  defineOp({
    name: "topic.vote",
    permission: "session.participate",
    input: z.object({ id: str(50) }),
    run: async ({ db, m, meetingId, workspaceId }, o) => {
      // The person running the meeting votes too, round or not
      const personId = m.viewer.memberId ?? (m.can("session.run") ? m.ws.member.personId || null : null);
      if (!personId) throw new OpError("membersOnlyVote");
      const topic = await db.topic.findFirst({ where: { id: o.id, meetingId }, select: { id: true } });
      if (!topic) throw new OpError("notFound");
      const key = { topicId_personId: { topicId: topic.id, personId } };
      if (await db.topicVote.findUnique({ where: key })) {
        await db.topicVote.delete({ where: key });
        return;
      }
      const used = await db.topicVote.count({ where: { personId, topic: { meetingId } } });
      if (used >= VOTES_PER_PERSON) throw new OpError("votesUsed", { count: VOTES_PER_PERSON });
      await db.topicVote.create({ data: { workspaceId, topicId: topic.id, personId } });
    },
  }),
  defineOp({
    name: "topic.done",
    permission: "session.run",
    input: z.object({ id: str(50), done: z.boolean() }),
    run: async ({ db, meetingId }, o) => {
      await db.topic.updateMany({ where: { id: o.id, meetingId }, data: { done: o.done } });
    },
  }),
  defineOp({
    name: "topic.delete",
    permission: "session.participate",
    input: z.object({ id: str(50) }),
    run: async ({ db, m, meetingId }, o) => {
      const t = await db.topic.findFirst({ where: { id: o.id, meetingId } });
      if (!t) return;
      if (t.byId !== actorId(m.viewer) && !m.viewer.isHost) throw new AccessError(403, "ownTopicsOnly");
      await db.topic.delete({ where: { id: t.id } });
    },
  }),
  defineOp({
    name: "comment.like",
    permission: "session.participate",
    session: "read",
    input: z.object({ ownerId: str(50), section: str(60), itemText: str(2000).min(1), projectId: str(50).nullable().optional() }),
    run: async ({ db, m, requireSession, meetingId, workspaceId }, o) => {
      const by = requireActor(m.viewer);
      await requireParticipant({ db, meetingId }, o.ownerId);
      const item = await commentedItem(db, meetingId, o);
      const where = { sessionId: requireSession().id, ownerId: o.ownerId, itemId: item.id, byId: by };
      // The 👍 only: the person's other reactions stay
      const existing = await db.checkInComment.findFirst({ where: { ...where, text: "", emoji: { in: ["", "👍"] } } });
      if (existing) await db.checkInComment.delete({ where: { id: existing.id } });
      else await db.checkInComment.create({ data: { ...where, workspaceId, text: "", emoji: "👍" } });
    },
  }),
  defineOp({
    name: "comment.react",
    permission: "session.participate",
    session: "read",
    /** A reaction on a line, put or taken back: one of each emoji per person */
    input: z.object({
      ownerId: str(50),
      section: str(60),
      itemText: str(2000).min(1),
      projectId: str(50).nullable().optional(),
      emoji: z.enum(LINE_REACTIONS),
    }),
    run: async ({ db, m, requireSession, meetingId, workspaceId }, o) => {
      const by = requireActor(m.viewer);
      await requireParticipant({ db, meetingId }, o.ownerId);
      const item = await commentedItem(db, meetingId, o);
      const where = { sessionId: requireSession().id, ownerId: o.ownerId, itemId: item.id, byId: by, text: "" };
      // A 👍 from before there were several reactions has no emoji
      const mine = await db.checkInComment.findFirst({
        where: { ...where, emoji: o.emoji === "👍" ? { in: ["", "👍"] } : o.emoji },
      });
      if (mine) await db.checkInComment.delete({ where: { id: mine.id } });
      else await db.checkInComment.create({ data: { ...where, workspaceId, emoji: o.emoji } });
    },
  }),
  defineOp({
    name: "comment.add",
    permission: "session.participate",
    session: "read",
    input: z.object({
      ownerId: str(50),
      section: str(60),
      itemText: str(2000).min(1),
      projectId: str(50).nullable().optional(),
      text: str(300).min(1),
    }),
    run: async ({ db, m, requireSession, meetingId, workspaceId }, o) => {
      const by = requireActor(m.viewer);
      await requireParticipant({ db, meetingId }, o.ownerId);
      const item = await commentedItem(db, meetingId, o);
      await db.checkInComment.create({
        data: { workspaceId, sessionId: requireSession().id, ownerId: o.ownerId, itemId: item.id, byId: by, text: o.text },
      });
    },
  }),
  defineOp({
    name: "comment.delete",
    permission: "session.participate",
    input: z.object({ id: str(50) }),
    run: async ({ db, m, meetingId }, o) => {
      const c = await db.checkInComment.findFirst({ where: { id: o.id, session: { meetingId } } });
      if (!c) return;
      if (c.byId !== actorId(m.viewer) && !m.viewer.isHost) throw new AccessError(403, "ownCommentsOnly");
      await db.checkInComment.delete({ where: { id: c.id } });
    },
  }),
  defineOp({
    name: "action.add",
    // The host gives actions to anyone of the meeting; everyone else, observers included, only to themselves
    permission: "meeting.read",
    session: "read",
    input: z.object({
      text: str(300).min(1),
      ownerId: str(50),
      originText: str(500).nullable().default(null),
      /** Project it moves forward; by default the project presented at the current step */
      projectId: str(50).nullable().optional(),
    }),
    run: async ({ db, session, meetingId, workspaceId, m }, o) => {
      if (!m.viewer.isHost && o.ownerId !== m.viewer.personId) throw new AccessError(403, "ownActionsOnly");
      await requireParticipant({ db, meetingId }, o.ownerId, "unknownOwner");
      const projectId = o.projectId === undefined ? projectOfKey(session?.stepKey ?? "") : o.projectId;
      if (projectId && !(await db.meetingProject.findFirst({ where: { meetingId, projectId }, select: { projectId: true } })))
        throw new OpError("notFound");
      await deliver(db, workspaceId, {
        to: [o.ownerId],
        kind: "action.assigned",
        actorId: m.ws.member.personId,
        meetingId,
        data: { text: o.text },
        href: "/actions",
      });
      await db.action.create({
        data: {
          workspaceId,
          meetingId,
          text: o.text,
          ownerId: o.ownerId,
          originDate: decidedOn(session, timeZoneOf(m.meeting, m.workspace)),
          originText: o.originText ?? o.text,
          // Decided during the session: the step it was decided at, so the minutes list it under that slide or turn
          originStep: session?.startedAt && !session.endedAt ? baseKeyOf(session.stepKey) : null,
          projectId,
        },
      });
    },
  }),
  defineOp({
    name: "action.update",
    // Observers can own actions too: they move them forward like anyone
    permission: "meeting.read",
    input: z.object({
      id: str(50),
      status: z.enum(["open", "doing", "done"]).optional(),
      ownerId: str(50).optional(),
      /** Where it stands, in a sentence; empty clears it */
      progress: z.string().max(300).optional(),
    }),
    run: async ({ db, m, meetingId, workspaceId }, o) => {
      const a = await db.action.findFirst({ where: { id: o.id, meetingId } });
      if (!a) throw new OpError("notFound");
      // A participant only moves their own actions forward; reassigning them is up to the host
      if (!m.viewer.isHost && (a.ownerId !== m.viewer.personId || o.ownerId)) throw new AccessError(403, "ownActionsOnly");
      const progress = o.progress === undefined ? undefined : o.progress.replace(/\s+/g, " ").trim() || null;
      if (o.ownerId) await requireParticipant({ db, meetingId }, o.ownerId, "unknownOwner");
      if (o.ownerId && o.ownerId !== a.ownerId)
        await deliver(db, workspaceId, {
          to: [o.ownerId],
          kind: "action.assigned",
          actorId: m.ws.member.personId,
          meetingId,
          data: { text: a.text },
          href: "/actions",
        });
      await db.action.update({
        where: { id: a.id },
        data: {
          ...(o.ownerId ? { ownerId: o.ownerId } : {}),
          ...(o.status ? { status: o.status, doneAt: o.status === "done" ? new Date() : null } : {}),
          ...(progress !== undefined && progress !== a.progress ? { progress, progressAt: progress ? new Date() : null } : {}),
        },
      });
    },
  }),
  defineOp({
    name: "action.delete",
    permission: "session.run",
    input: z.object({ id: str(50) }),
    run: async ({ db, meetingId }, o) => {
      await db.action.deleteMany({ where: { id: o.id, meetingId } });
    },
  }),
];
