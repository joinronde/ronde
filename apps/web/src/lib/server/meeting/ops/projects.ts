import "server-only";
import { PROJECT_HEALTHS, PROJECTS_BY, type ProjectHealth } from "@ronde/core/types";
import { plainItem } from "@ronde/core/util";
import { str } from "@ronde/modules/shared";
import { z } from "zod";
import { AccessError, OpError } from "../../errors";
import { deliver } from "../../inbox";
import { visibleWhere } from "../../projects";
import { holdProjectSheet, saveProjectSheet } from "../projects";
import { defineOp, type OpContext } from "./define";
import { commentedItem } from "./live";

// Projects of a meeting: the ones it follows, the order of the project round, their shared sheets

const health = z.enum(PROJECT_HEALTHS as [ProjectHealth, ...ProjectHealth[]]);

/** Whether the viewer works on a project the meeting follows (its lead or a member); throws when it does not follow it */
async function worksOn(db: OpContext["db"], m: OpContext["m"], meetingId: string, projectId: string) {
  const followed = await db.meetingProject.findFirst({
    where: { meetingId, projectId, project: { archivedAt: null } },
    include: {
      project: { select: { leadId: true, members: { where: { personId: m.ws.member.personId }, select: { personId: true } } } },
    },
  });
  if (!followed) throw new OpError("notFound");
  return followed.project.leadId === m.ws.member.personId || followed.project.members.length > 0;
}

/** The people working on the project keep its sheet; the host can fix it */
async function mayWriteSheet(db: OpContext["db"], m: OpContext["m"], meetingId: string, projectId: string) {
  if (!(await worksOn(db, m, meetingId, projectId)) && !m.can("checkin.write.any")) throw new AccessError(403, "projectMembersOnly");
}

export const projectOps = [
  defineOp({
    name: "project.sheet",
    permission: "checkin.write.own",
    /** Only the fields given change: two people writing the sheet at once do not erase each other */
    input: z.object({
      projectId: str(50),
      health: health.nullable().optional(),
      headline: str(4000).optional(),
      /** Set from the control room, during the project's step */
      live: z.boolean().optional(),
      /** Saved as it is typed: the writer keeps the reservation */
      keep: z.boolean().optional(),
    }),
    run: async ({ db, m, meetingId, workspaceId }, o) => {
      await mayWriteSheet(db, m, meetingId, o.projectId);
      // The host setting the health live goes through a reservation; the message stays its writer's
      const live = !!o.live && o.headline === undefined && m.can("session.run");
      await saveProjectSheet(
        db,
        { workspaceId, meetingId, projectId: o.projectId },
        { health: o.health, headline: o.headline },
        m.ws.member.personId,
        { force: live, keep: !!o.keep },
      );
    },
  }),
  defineOp({
    name: "project.hold",
    permission: "checkin.write.own",
    /** Reserves the sheet while someone writes it (renewed by their page), or releases it */
    input: z.object({ projectId: str(50), on: z.boolean() }),
    run: async ({ db, m, meetingId, workspaceId, quiet }, o) => {
      await mayWriteSheet(db, m, meetingId, o.projectId);
      const changed = await holdProjectSheet(db, { workspaceId, meetingId, projectId: o.projectId }, m.ws.member.personId, o.on);
      // A renewal changes nothing the others see
      if (!changed) quiet();
    },
  }),
  defineOp({
    name: "project.add",
    permission: "session.run",
    session: "lock",
    /** Presents a project this session although nothing is written about it (`on`), or no longer */
    input: z.object({ projectId: str(50), on: z.boolean() }),
    run: async ({ db, meetingId, requireSession }, o) => {
      const s = requireSession();
      if (!(await db.meetingProject.findFirst({ where: { meetingId, projectId: o.projectId }, select: { projectId: true } })))
        throw new OpError("notFound");
      const added = s.projectsAdded.filter((id) => id !== o.projectId);
      await db.session.update({ where: { id: s.id }, data: { projectsAdded: o.on ? [...added, o.projectId] : added } });
    },
  }),
  defineOp({
    name: "item.with",
    permission: "checkin.write.own",
    /**
     * Joins a line someone else wrote (`on`), about a project or their own, or leaves it: the person took part in
     * it, their face shows on it too. With `personId`, someone else is put on it or taken off: by the hosts on any
     * line, by the people working on the project on its lines; its author may also take someone off.
     */
    input: z.object({
      ownerId: str(50),
      section: str(60),
      itemText: str(2000).min(1),
      /** null: a line of the person's own round, not about a project */
      projectId: str(50).nullable(),
      on: z.boolean(),
      personId: str(50).optional(),
    }),
    run: async ({ db, m, meetingId, workspaceId }, o) => {
      const me = m.viewer.memberId;
      const personId = o.personId ?? me;
      if (!personId) throw new AccessError(403, "joinParticipantsOnly");
      const item = await commentedItem(db, meetingId, o);
      // Someone else: the hosts, or on a project's line the people working on it (a personal line: the hosts only)
      const others =
        m.can("checkin.write.any") || (!!o.projectId && !!m.ws.member.personId && (await worksOn(db, m, meetingId, o.projectId)));
      if (personId !== me && !others && (o.on || item.personId !== me)) throw new AccessError(403, "assignNotAllowed");
      // Its author wrote it: nothing to join
      if (personId === item.personId) return;
      if (!o.on) {
        await db.checkInItemContributor.deleteMany({ where: { itemId: item.id, personId } });
        return;
      }
      if (!(await db.meetingParticipant.findFirst({ where: { meetingId, personId, role: { not: "observer" } }, select: { id: true } })))
        throw new AccessError(403, "joinParticipantsOnly");
      const { count } = await db.checkInItemContributor.createMany({
        data: [{ workspaceId, itemId: item.id, personId }],
        skipDuplicates: true,
      });
      // Put on it by someone else: told under the bell, with the line
      if (count && personId !== me)
        await deliver(db, workspaceId, {
          to: [personId],
          kind: "line.assigned",
          actorId: m.ws.member.personId,
          meetingId,
          data: { text: plainItem(o.itemText).slice(0, 200) },
          href: `/m/${meetingId}/me`,
        });
    },
  }),
  defineOp({
    name: "project.order",
    permission: "session.run",
    session: "lock",
    input: z.object({ order: z.array(str(50)).max(200) }),
    run: async ({ db, meetingId, requireSession }, o) => {
      const s = requireSession();
      const followed = new Set(
        (await db.meetingProject.findMany({ where: { meetingId }, select: { projectId: true } })).map((p) => p.projectId),
      );
      await db.session.update({ where: { id: s.id }, data: { projectOrder: [...new Set(o.order)].filter((id) => followed.has(id)) } });
    },
  }),
  defineOp({
    name: "meeting.projectsBy",
    permission: "meeting.configure",
    /** Who adds projects for the meeting to follow: its hosts, or everyone taking part */
    input: z.object({ by: z.enum(PROJECTS_BY) }),
    run: async ({ db, m, meetingId }, o) => {
      await db.meeting.update({ where: { id: meetingId }, data: { projectsBy: o.by } });
      m.meeting.projectsBy = o.by;
    },
  }),
  defineOp({
    name: "project.follow",
    permission: "checkin.write.own",
    /** A project of the portfolio joins the ones the meeting follows, last: brought by a participant when the hosts let them */
    input: z.object({ projectId: str(50) }),
    run: async ({ db, m, meetingId, workspaceId }, o) => {
      if (!m.can("meeting.configure") && m.meeting.projectsBy !== "participants") throw new AccessError(403, "projectsByHosts");
      if (await db.meetingProject.findFirst({ where: { meetingId, projectId: o.projectId }, select: { projectId: true } })) return;
      // A private project only for the people who see it
      if (!(await db.project.findFirst({ where: { id: o.projectId, archivedAt: null, ...visibleWhere(m.ws) }, select: { id: true } })))
        throw new OpError("notFound");
      const last = await db.meetingProject.aggregate({ where: { meetingId }, _max: { position: true } });
      await db.meetingProject.create({
        data: { workspaceId, meetingId, projectId: o.projectId, position: (last._max.position ?? -1) + 1 },
      });
    },
  }),
  defineOp({
    name: "meeting.projects",
    permission: "meeting.configure",
    input: z.object({ projectIds: z.array(str(50)).max(200) }),
    run: async ({ db, m, meetingId, workspaceId }, o) => {
      // Archived projects are out of the settings' list: the meeting keeps following them, after the others
      const archived = (
        await db.meetingProject.findMany({ where: { meetingId, project: { archivedAt: { not: null } } }, select: { projectId: true } })
      ).map((r) => r.projectId);
      const ids = [...new Set([...o.projectIds, ...archived])];
      // Projects already followed stay; a new one must be one the person sees
      const before = new Set(
        (await db.meetingProject.findMany({ where: { meetingId }, select: { projectId: true } })).map((r) => r.projectId),
      );
      const added = ids.filter((id) => !before.has(id));
      const found = await db.project.count({ where: { id: { in: added }, archivedAt: null, ...visibleWhere(m.ws) } });
      if (found !== added.length) throw new OpError("notFound");
      const kept = await db.project.count({ where: { id: { in: ids.filter((id) => before.has(id)) } } });
      if (kept + found !== ids.length) throw new OpError("notFound");
      // A project no longer followed: what people wrote about it goes back to their own check-in
      const gone = { meetingId, projectId: { notIn: ids } };
      await db.checkInItem.updateMany({ where: { ...gone, sessionId: null }, data: { projectId: null } });
      await db.projectUpdate.deleteMany({ where: { ...gone, sessionId: null } });
      await db.meetingProject.deleteMany({ where: gone });
      for (const [position, projectId] of ids.entries())
        await db.meetingProject.upsert({
          where: { meetingId_projectId: { meetingId, projectId } },
          create: { workspaceId, meetingId, projectId, position },
          update: { position },
        });
    },
  }),
];
