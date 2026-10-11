import { parseRecord } from "@ronde/core/record";
import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceContext } from "@/lib/server/authz";
import { activeSeats } from "@/lib/server/billing";
import { isSampleAddress } from "@/lib/server/mailer";
import { createSample, deleteSample } from "@/lib/server/sample";
import { invite } from "@/lib/server/workspaces";
import { type Fixture, meeting, workspace } from "./fixtures";

// The sample meeting: a fictitious team and a month of history in the workspace's language, that counts for
// nothing (seats), can't be written to (invitations, emails) and goes away for good

let f: Fixture;
let ws: WorkspaceContext;

beforeAll(async () => {
  const w = await workspace("sample");
  await prisma.workspace.update({ where: { id: w.ws.id }, data: { locale: "fr", timezone: "Europe/Paris" } });
  f = await meeting(w, "Real weekly");
  ws = { ...f.ctx.ws, workspace: { ...f.ctx.ws.workspace, locale: "fr", timezone: "Europe/Paris" } };
});

describe("sample meeting", () => {
  let id: string;

  it("is a weekly sync with a fictitious team and a month behind it, in the workspace's language", async () => {
    id = (await createSample(ws)).id;
    const m = await prisma.meeting.findUniqueOrThrow({
      where: { id },
      include: { participants: { include: { person: true } }, sessions: { orderBy: { date: "asc" } } },
    });
    expect(m).toMatchObject({ sample: true, name: "Point hebdo (exemple)", reminderEnabled: false });
    const team = m.participants.filter((p) => p.person.sample);
    expect(team.map((p) => p.person.firstName).sort()).toEqual(["Emma", "Lucas", "Sarah", "Sofia", "Tom"]);
    expect(team.every((p) => isSampleAddress(p.person.email))).toBe(true);
    expect(await prisma.personAvatar.count({ where: { personId: { in: team.map((p) => p.personId) } } })).toBe(5);
    // The one who asked hosts it and takes a turn
    expect(m.participants.find((p) => p.personId === ws.member.personId)).toMatchObject({ role: "host", active: true });

    const archived = m.sessions.filter((s) => s.status === "archived");
    expect(archived).toHaveLength(4);
    const last = parseRecord(archived.at(-1)!.record)!;
    expect(last.rating?.avg).toBeGreaterThan(3);
    expect(last.kudos[0]?.text).toBe("Merci d'avoir débloqué l'export en une journée");
    expect(archived.at(-1)!.summary).toContain("Emma");
    // What was planned one week is done the next: the stats see the follow-through
    const done = await prisma.checkInItem.count({ where: { meetingId: id, sessionId: { not: null }, sourceItemId: { not: null } } });
    expect(done).toBeGreaterThan(8);

    // The coming session is ready to run
    const current = m.sessions.find((s) => s.status === "current")!;
    // French typography: a narrow no-break space before the question mark
    expect(current.icebreaker).toBe("Votre petite victoire de la semaine\u202f?");
    expect(await prisma.checkIn.count({ where: { meetingId: id } })).toBe(5);
    expect(await prisma.action.findMany({ where: { meetingId: id }, select: { status: true }, orderBy: { createdAt: "asc" } })).toEqual([
      { status: "done" },
      { status: "doing" },
      { status: "open" },
    ]);
  });

  it("is created once", async () => {
    expect((await createSample(ws)).id).toBe(id);
    expect(await prisma.meeting.count({ where: { workspaceId: ws.workspace.id, sample: true } })).toBe(1);
  });

  it("costs no seat, and its people are never invited", async () => {
    // Nobody took part in the real meeting yet; the host runs the sample's session: still nobody to pay for
    await prisma.session.updateMany({ where: { meetingId: f.meetingId }, data: { startedAt: null } });
    await prisma.session.updateMany({ where: { meetingId: id, status: "current" }, data: { startedAt: new Date() } });
    expect(await activeSeats(ws.workspace.id)).toBe(0);
    await prisma.session.updateMany({ where: { meetingId: f.meetingId, status: "current" }, data: { startedAt: new Date() } });
    expect(await activeSeats(ws.workspace.id)).toBe(1);
    const emma = await prisma.person.findFirstOrThrow({ where: { workspaceId: ws.workspace.id, sample: true, firstName: "Emma" } });
    await expect(invite(ws, { email: emma.email, firstName: "Emma", role: "member" })).rejects.toThrow("samplePerson");
    expect(await prisma.invitation.count({ where: { personId: emma.id } })).toBe(0);
  });

  it("goes away for good, with its fictitious team", async () => {
    // Someone of the team added to a real meeting stays (the real meeting needs them)
    const sofia = await prisma.person.findFirstOrThrow({ where: { workspaceId: ws.workspace.id, sample: true, firstName: "Sofia" } });
    await prisma.meetingParticipant.create({
      data: { workspaceId: ws.workspace.id, meetingId: f.meetingId, personId: sofia.id, role: "participant", position: 9 },
    });
    await deleteSample(ws, id);
    expect(await prisma.meeting.count({ where: { id } })).toBe(0);
    expect(await prisma.session.count({ where: { meetingId: id } })).toBe(0);
    expect(await prisma.person.findMany({ where: { workspaceId: ws.workspace.id, sample: true }, select: { firstName: true } })).toEqual([
      { firstName: "Sofia" },
    ]);
    // A new one can be opened again
    expect((await createSample(ws)).id).not.toBe(id);
  });
});
