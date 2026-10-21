import { can } from "@ronde/core/permissions";
import { parseRecord } from "@ronde/core/record";
import { prisma } from "@ronde/db";
import { describe, expect, it } from "vitest";
import type { MeetingCtx } from "@/lib/server/meeting/context";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { createProject, deleteProject, loadPortfolio, loadProject, updateProject } from "@/lib/server/projects";
import { type Fixture, meeting, workspace } from "./fixtures";

// The project round and the portfolio: sheets kept by the people of a project, items written in its tab,
// what archiving keeps, and who may read what

const empty = { done: [], next: [], blockers: [], other: [] };

/** The meeting as one of its participants, a plain member of the workspace */
function asParticipant(t: Fixture, personId: string): MeetingCtx {
  const principal = { ...t.ctx.ws.principal, personId, workspaceRole: "member" as const };
  return {
    ...t.ctx,
    role: "participant",
    ws: { ...t.ctx.ws, member: { ...t.ctx.ws.member, personId, role: "member" }, principal, can: (p) => can(principal, p) },
    viewer: { ...t.ctx.viewer, personId, memberId: personId, isHost: false, isAdmin: false },
    can: (p) => can({ ...principal, meetingRole: "participant" }, p),
  };
}

async function withRound(t: Fixture) {
  await prisma.meeting.update({
    where: { id: t.meetingId },
    data: {
      agenda: [
        { id: "intro", type: "intro" },
        { id: "round", type: "round" },
        { id: "projects", type: "projects", order: "manual" },
      ],
    },
  });
  t.ctx.meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: t.meetingId } });
}

describe("project sheets", () => {
  it("are kept by the people of the project and the host, not by the other participants", async () => {
    const w = await workspace(`sheets-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const outsider = await prisma.person.create({ data: { workspaceId: t.workspaceId, email: `out@${w.ws.slug}.test`, firstName: "Out" } });
    await prisma.meetingParticipant.create({
      data: { workspaceId: t.workspaceId, meetingId: t.meetingId, personId: outsider.id, position: 2 },
    });
    await expect(
      runOp(asParticipant(t, outsider.id), { op: "project.sheet", projectId: t.projectId, health: "offTrack", headline: "Not mine" }),
    ).rejects.toMatchObject({ key: "projectMembersOnly" });
    await runOp(asParticipant(t, t.memberId), { op: "project.sheet", projectId: t.projectId, health: "atRisk", headline: "Late" });
    // The host fixes it
    await runOp(t.ctx, { op: "project.sheet", projectId: t.projectId, health: "atRisk", headline: "Late by a week" });
    const drafts = await prisma.projectUpdate.findMany({ where: { meetingId: t.meetingId, sessionId: null } });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ health: "atRisk", headline: "Late by a week", updatedById: t.hostPersonId });
  });

  it("are reserved while someone writes them, until they save or their reservation lapses", async () => {
    const w = await workspace(`hold-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const mate = await prisma.person.create({ data: { workspaceId: t.workspaceId, email: `mate@${w.ws.slug}.test`, firstName: "Mate" } });
    await prisma.meetingParticipant.create({
      data: { workspaceId: t.workspaceId, meetingId: t.meetingId, personId: mate.id, position: 2 },
    });
    await prisma.projectMember.create({ data: { workspaceId: t.workspaceId, projectId: t.projectId, personId: mate.id } });
    const me = asParticipant(t, t.memberId);
    const them = asParticipant(t, mate.id);
    const sheet = async () => (await loadSnapshot(t.ctx)).projects.find((p) => p.id === t.projectId)?.sheet;
    const projectId = t.projectId;
    // No sheet yet for this session
    await prisma.projectUpdate.deleteMany({ where: { meetingId: t.meetingId } });

    // Reserved then left without a word: the empty sheet goes away
    await runOp(me, { op: "project.hold", projectId, on: true });
    await runOp(me, { op: "project.hold", projectId, on: false });
    expect(await sheet()).toBeNull();
    await runOp(me, { op: "project.hold", projectId, on: true });
    // Reserved, not written: nobody updated it yet
    expect(await sheet()).toMatchObject({ editingById: t.memberId, updatedById: null, updatedAt: null });
    // Renewed while still fresh: unchanged; past half its time: extended
    const until = (await sheet())!.editingUntil!;
    await runOp(me, { op: "project.hold", projectId, on: true });
    expect((await sheet())?.editingUntil).toBe(until);
    await prisma.projectUpdate.updateMany({ where: { meetingId: t.meetingId }, data: { editingUntil: new Date(Date.now() + 10_000) } });
    await runOp(me, { op: "project.hold", projectId, on: true });
    expect((await sheet())!.editingUntil!).toBeGreaterThan(Date.now() + 60_000);
    await expect(runOp(them, { op: "project.hold", projectId, on: true })).rejects.toMatchObject({ key: "projectSheetHeld" });
    await expect(runOp(them, { op: "project.sheet", projectId, headline: "Mine" })).rejects.toMatchObject({ key: "projectSheetHeld" });
    // Releasing someone else's reservation changes nothing
    await runOp(them, { op: "project.hold", projectId, on: false });
    expect((await sheet())?.editingById).toBe(t.memberId);
    // The host's sheet form waits like everyone; setting the health live, from the control room, goes through
    await expect(runOp(t.ctx, { op: "project.sheet", projectId, health: "onTrack" })).rejects.toMatchObject({ key: "projectSheetHeld" });
    await runOp(t.ctx, { op: "project.sheet", projectId, health: "atRisk", live: true });
    // …without becoming the author of the message
    expect((await sheet())?.headlineById).toBeNull();
    // Saving releases it
    await runOp(me, { op: "project.sheet", projectId, headline: "On it" });
    expect(await sheet()).toMatchObject({ editingById: null, health: "atRisk", headline: "On it", headlineById: t.memberId });
    await runOp(t.ctx, { op: "project.sheet", projectId, health: "offTrack", live: true });
    expect(await sheet()).toMatchObject({ headline: "On it", headlineById: t.memberId, updatedById: t.hostPersonId });

    await runOp(them, { op: "project.hold", projectId, on: true });
    // A page left open without news: the reservation lapses
    await prisma.projectUpdate.updateMany({ where: { meetingId: t.meetingId }, data: { editingUntil: new Date(Date.now() - 1000) } });
    expect((await sheet())?.editingById).toBeNull();
    await runOp(me, { op: "project.hold", projectId, on: true });
    await runOp(me, { op: "project.hold", projectId, on: false });
    expect(await sheet()).toMatchObject({ editingById: null, headline: "On it" });
  });

  it("stay reserved while saved as they are typed, until the writer leaves them", async () => {
    const w = await workspace(`keep-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const me = asParticipant(t, t.memberId);
    await runOp(me, { op: "project.hold", projectId: t.projectId, on: true });
    await runOp(me, { op: "project.sheet", projectId: t.projectId, headline: "Draft…", keep: true });
    const sheet = async () => (await loadSnapshot(t.ctx)).projects.find((p) => p.id === t.projectId)?.sheet;
    expect(await sheet()).toMatchObject({ headline: "Draft…", editingById: t.memberId });
    await runOp(me, { op: "project.sheet", projectId: t.projectId, headline: "Done" });
    expect(await sheet()).toMatchObject({ headline: "Done", editingById: null });
  });

  it("only exist for the projects the meeting follows", async () => {
    const w = await workspace(`follow-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const other = await prisma.project.create({ data: { workspaceId: t.workspaceId, slug: "other", name: "Other" } });
    await expect(runOp(t.ctx, { op: "project.sheet", projectId: other.id, health: null, headline: "x" })).rejects.toMatchObject({
      key: "notFound",
    });
    await expect(
      runOp(t.ctx, { op: "checkIn.save", memberId: t.memberId, ...empty, byProject: { [other.id]: { ...empty, done: ["x"] } } }),
    ).rejects.toMatchObject({ key: "notFound" });
  });
});

describe("lines written together", () => {
  async function pair() {
    const w = await workspace(`with-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
    const t = await meeting(w, "Weekly");
    await withRound(t);
    const mate = await prisma.person.create({ data: { workspaceId: t.workspaceId, email: `mate@${w.ws.slug}.test`, firstName: "Mate" } });
    await prisma.meetingParticipant.create({
      data: { workspaceId: t.workspaceId, meetingId: t.meetingId, personId: mate.id, position: 2 },
    });
    await runOp(asParticipant(t, t.memberId), {
      op: "checkIn.save",
      memberId: t.memberId,
      ...empty,
      byProject: { [t.projectId]: { ...empty, done: ["Login page", "Export"] } },
    });
    const line = { ownerId: t.memberId, section: "done", itemText: "Login page", projectId: t.projectId };
    return { t, mate: mate.id, them: asParticipant(t, mate.id), line };
  }

  it("show the people who joined them, who then speak for the project too", async () => {
    const { t, mate, them, line } = await pair();
    await runOp(them, { op: "item.with", ...line, on: true });
    // Joining twice, or one's own line: nothing more
    await runOp(them, { op: "item.with", ...line, on: true });
    await runOp(asParticipant(t, t.memberId), { op: "item.with", ...line, on: true });
    const snap = await loadSnapshot(t.ctx);
    expect(snap.contributors).toEqual([{ ...line, personId: mate }]);
    expect(snap.blockData.projects?.list[0]?.authorIds).toEqual(expect.arrayContaining([t.memberId, mate]));
    // Nobody joins someone else in their name
    await expect(runOp(them, { op: "item.with", ...line, on: true, personId: t.memberId })).rejects.toMatchObject({
      key: "assignNotAllowed",
    });
    // The line reworded in place keeps them; moved elsewhere or removed, it does not
    await runOp(asParticipant(t, t.memberId), {
      op: "checkIn.save",
      memberId: t.memberId,
      ...empty,
      byProject: { [t.projectId]: { ...empty, done: ["Login page, with SSO", "Export"] } },
    });
    expect((await loadSnapshot(t.ctx)).contributors).toEqual([{ ...line, itemText: "Login page, with SSO", personId: mate }]);
    // Archived with the line: the minutes name them
    await runOp(t.ctx, { op: "meeting.goto", key: "end" });
    await runOp(t.ctx, { op: "meeting.archive", summary: null, omit: [] });
    const record = parseRecord((await prisma.session.findFirstOrThrow({ where: { id: t.sessionId } })).record)!;
    expect(record.checkIns[t.memberId]?.items.find((i) => i.text === "Login page, with SSO")?.with).toEqual([mate]);
  });

  it("do not move to another line when theirs is removed", async () => {
    const { t, them, line } = await pair();
    await runOp(them, { op: "item.with", ...line, on: true });
    // "Login page" removed, "Export" reworded: nothing alike, nobody moves onto it
    await runOp(asParticipant(t, t.memberId), {
      op: "checkIn.save",
      memberId: t.memberId,
      ...empty,
      byProject: { [t.projectId]: { ...empty, done: ["Export to CSV"] } },
    });
    expect((await loadSnapshot(t.ctx)).contributors).toEqual([]);
  });

  it("let the hosts put anyone on a line, and the people working on the project put others on its lines", async () => {
    const { t, mate, them, line } = await pair();
    const lead = asParticipant(t, t.memberId);
    // The project's lead (its author here) puts a colleague on it; the colleague is told under the bell
    await runOp(lead, { op: "item.with", ...line, on: true, personId: mate });
    expect((await loadSnapshot(t.ctx)).contributors).toEqual([{ ...line, personId: mate }]);
    expect(await prisma.inboxItem.findFirst({ where: { personId: mate, kind: "line.assigned" } })).toMatchObject({
      actorId: t.memberId,
      data: { text: "Login page" },
    });
    // Someone not working on the project puts nobody on it, nor takes anyone off
    await expect(runOp(them, { op: "item.with", ...line, itemText: "Export", on: true, personId: t.hostPersonId })).rejects.toMatchObject({
      key: "assignNotAllowed",
    });
    // A line of one's own round: the hosts only
    await runOp(lead, { op: "checkIn.save", memberId: t.memberId, ...empty, done: ["Reviewed the release"] });
    const own = { ownerId: t.memberId, section: "done", itemText: "Reviewed the release", projectId: null };
    await expect(runOp(lead, { op: "item.with", ...own, on: true, personId: mate })).rejects.toMatchObject({ key: "assignNotAllowed" });
    await runOp(t.ctx, { op: "item.with", ...own, on: true, personId: mate });
    expect((await loadSnapshot(t.ctx)).contributors).toContainEqual({ ...own, personId: mate });
    // An observer takes no part in it
    const watcher = await prisma.person.create({ data: { workspaceId: t.workspaceId, email: `watch-${t.meetingId}@x.test`, firstName: "W" } });
    await prisma.meetingParticipant.create({
      data: { workspaceId: t.workspaceId, meetingId: t.meetingId, personId: watcher.id, position: 3, role: "observer" },
    });
    await expect(runOp(t.ctx, { op: "item.with", ...own, on: true, personId: watcher.id })).rejects.toMatchObject({
      key: "joinParticipantsOnly",
    });
  });

  it("let them leave, and let the author take someone off", async () => {
    const { t, them, line } = await pair();
    await runOp(them, { op: "item.with", ...line, on: true });
    await runOp(them, { op: "item.with", ...line, on: false });
    expect((await loadSnapshot(t.ctx)).contributors).toEqual([]);
    await runOp(them, { op: "item.with", ...line, on: true });
    const mate = (await loadSnapshot(t.ctx)).contributors[0]!.personId;
    await runOp(asParticipant(t, t.memberId), { op: "item.with", ...line, on: false, personId: mate });
    expect((await loadSnapshot(t.ctx)).contributors).toEqual([]);
  });
});

describe("a check-in written in two places", () => {
  it("saved for the first time from two places at once, is saved once", async () => {
    const w = await workspace(`first-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const mate = await prisma.person.create({ data: { workspaceId: t.workspaceId, email: `mate@${w.ws.slug}.test`, firstName: "Mate" } });
    await prisma.meetingParticipant.create({
      data: { workspaceId: t.workspaceId, meetingId: t.meetingId, personId: mate.id, position: 2 },
    });
    const save = (ctx: MeetingCtx) => runOp(ctx, { op: "checkIn.save", memberId: mate.id, ...empty, done: ["A"], since: null });
    const results = await Promise.allSettled([save(asParticipant(t, mate.id)), save(t.ctx)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.checkInItem.count({ where: { meetingId: t.meetingId, personId: mate.id } })).toBe(1);
  });

  it("is not overwritten by a draft started from an older version", async () => {
    const w = await workspace(`since-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const me = asParticipant(t, t.memberId);
    const first = (await loadSnapshot(t.ctx)).checkIns[t.memberId]?.updatedAt ?? null;
    await runOp(me, { op: "checkIn.save", memberId: t.memberId, ...empty, done: ["A"], since: first });
    const at = (await loadSnapshot(t.ctx)).checkIns[t.memberId]!.updatedAt;
    // The host fixes it meanwhile
    await runOp(t.ctx, { op: "checkIn.save", memberId: t.memberId, ...empty, done: ["A", "B"], since: at });
    await expect(runOp(me, { op: "checkIn.save", memberId: t.memberId, ...empty, done: ["A", "C"], since: at })).rejects.toMatchObject({
      key: "checkInChanged",
    });
    // A draft that never saw a saved version is refused too, once there is one
    await expect(runOp(me, { op: "checkIn.save", memberId: t.memberId, ...empty, done: ["C"], since: null })).rejects.toMatchObject({
      key: "checkInChanged",
    });
    // Without a version (another screen saving it), no check
    await runOp(t.ctx, { op: "checkIn.save", memberId: t.memberId, ...empty, done: ["A", "B"] });
    const now = (await loadSnapshot(t.ctx)).checkIns[t.memberId]!;
    expect(now.done).toEqual(["A", "B"]);
    await runOp(me, { op: "checkIn.save", memberId: t.memberId, ...empty, done: ["A", "B", "C"], since: now.updatedAt });
  });
});

describe("the project round", () => {
  it("gives each project its step, then archives its items and its sheet, whoever was absent", async () => {
    const w = await workspace(`round-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    await withRound(t);
    // The member writes about the project in its tab, then is absent: the project is still presented
    await runOp(asParticipant(t, t.memberId), {
      op: "checkIn.save",
      memberId: t.memberId,
      ...empty,
      other: ["Off on Friday"],
      byProject: { [t.projectId]: { ...empty, done: ["Login page"], blockers: ["Staging closed"] } },
    });
    await runOp(t.ctx, { op: "meeting.absent", id: t.memberId });
    const snap = await loadSnapshot(t.ctx);
    expect(snap.projects.map((p) => p.id)).toEqual([t.projectId]);
    expect(snap.checkIns[t.memberId]).toMatchObject({ other: ["Off on Friday"], byProject: { [t.projectId]: { done: ["Login page"] } } });
    expect(snap.blockData.projects?.list[0]).toMatchObject({ id: t.projectId, filled: true, authorIds: [t.memberId] });
    // An action created at the project's step moves the project forward
    await runOp(t.ctx, { op: "meeting.goto", key: `p:${t.projectId}` });
    await runOp(t.ctx, { op: "action.add", text: "Ask IT for staging", ownerId: t.memberId, originText: null });
    expect(await prisma.action.findFirst({ where: { text: "Ask IT for staging" } })).toMatchObject({ projectId: t.projectId });

    await runOp(t.ctx, { op: "meeting.goto", key: "end" });
    await runOp(t.ctx, { op: "meeting.archive", summary: null, omit: [] });
    const archived = await prisma.session.findFirstOrThrow({ where: { id: t.sessionId } });
    const record = parseRecord(archived.record)!;
    expect(record.projects).toEqual([
      expect.objectContaining({ id: t.projectId, presented: true, health: "onTrack", headline: "sheet", speakers: [] }),
    ]);
    // Its items went with the session; the absent member's own news wait for the next one
    const items = await prisma.checkInItem.findMany({ where: { meetingId: t.meetingId, personId: t.memberId } });
    expect(items.filter((i) => i.projectId === t.projectId).every((i) => i.sessionId === t.sessionId)).toBe(true);
    expect(items.find((i) => i.text === "Off on Friday")?.sessionId).toBeNull();
    expect(await prisma.projectUpdate.findFirst({ where: { meetingId: t.meetingId, sessionId: t.sessionId } })).toMatchObject({
      headline: "sheet",
    });
    expect(await prisma.projectUpdate.count({ where: { meetingId: t.meetingId, sessionId: null } })).toBe(0);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: t.projectId } })).health).toBe("onTrack");
  });

  it("presents a project nobody wrote about when the host adds it, for this session", async () => {
    const w = await workspace(`add-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    await withRound(t);
    // Nothing written about it: no sheet, no line
    await prisma.projectUpdate.deleteMany({ where: { meetingId: t.meetingId } });
    await prisma.checkInItem.deleteMany({ where: { meetingId: t.meetingId, projectId: t.projectId } });
    const steps = async () => (await loadSnapshot(t.ctx)).blockData.projects?.list.find((p) => p.id === t.projectId)?.filled;
    expect(await steps()).toBe(false);
    await runOp(t.ctx, { op: "project.add", projectId: t.projectId, on: true });
    expect((await loadSnapshot(t.ctx)).meeting?.projectsAdded).toEqual([t.projectId]);
    await runOp(t.ctx, { op: "project.add", projectId: t.projectId, on: false });
    expect((await loadSnapshot(t.ctx)).meeting?.projectsAdded).toEqual([]);
    // Only the host runs the round
    await expect(runOp(asParticipant(t, t.memberId), { op: "project.add", projectId: t.projectId, on: true })).rejects.toBeTruthy();
  });

  it("drops a sheet only reserved, so it does not hide the last real one", async () => {
    const w = await workspace(`empty-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    await withRound(t);
    await runOp(asParticipant(t, t.memberId), {
      op: "checkIn.save",
      memberId: t.memberId,
      ...empty,
      byProject: { [t.projectId]: { ...empty, done: ["Login page"] } },
    });
    // The sheet of the fixture emptied: someone reserved it and wrote nothing
    await prisma.projectUpdate.updateMany({
      where: { meetingId: t.meetingId, sessionId: null },
      data: { health: null, headline: "", updatedById: null, editingById: t.memberId, editingUntil: new Date(Date.now() + 60_000) },
    });
    await runOp(t.ctx, { op: "meeting.goto", key: "end" });
    await runOp(t.ctx, { op: "meeting.archive", summary: null, omit: [] });
    expect(await prisma.projectUpdate.count({ where: { meetingId: t.meetingId } })).toBe(0);
  });

  it("gives back what was written about a project the meeting stops following", async () => {
    const w = await workspace(`unfollow-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    await runOp(t.ctx, { op: "meeting.projects", projectIds: [] });
    const item = await prisma.checkInItem.findFirstOrThrow({ where: { meetingId: t.meetingId, text: "project work" } });
    expect(item.projectId).toBeNull();
    expect(await prisma.projectUpdate.count({ where: { meetingId: t.meetingId } })).toBe(0);
    expect(await prisma.meetingProject.count({ where: { meetingId: t.meetingId } })).toBe(0);
  });
});

describe("who adds projects", () => {
  it("keeps it to the hosts until they let every participant bring one, removing staying theirs", async () => {
    const w = await workspace(`projects-by-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const other = await prisma.project.create({ data: { workspaceId: t.workspaceId, slug: "other", name: "Other" } });
    const participant = asParticipant(t, t.memberId);
    await expect(runOp(participant, { op: "project.follow", projectId: other.id })).rejects.toMatchObject({ key: "projectsByHosts" });
    // Nothing to pick from either
    expect((await loadSnapshot(participant)).projectChoices).toBeNull();
    await expect(runOp(participant, { op: "meeting.projectsBy", by: "participants" })).rejects.toMatchObject({ key: "accessDenied" });
    await runOp(t.ctx, { op: "meeting.projectsBy", by: "participants" });
    expect((await loadSnapshot(t.ctx)).settings.projectsBy).toBe("participants");
    expect((await loadSnapshot(participant)).projectChoices?.map((p) => p.name)).toContain("Other");
    await runOp(participant, { op: "project.follow", projectId: other.id });
    // Last of the round; a second time changes nothing
    await runOp(participant, { op: "project.follow", projectId: other.id });
    const followed = await prisma.meetingProject.findMany({ where: { meetingId: t.meetingId }, orderBy: { position: "asc" } });
    expect(followed.map((r) => r.projectId)).toEqual([t.projectId, other.id]);
    await expect(runOp(participant, { op: "meeting.projects", projectIds: [t.projectId] })).rejects.toMatchObject({ key: "accessDenied" });
  });

  it("offers only projects the person sees", async () => {
    const w = await workspace(`projects-by-private-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const hidden = await prisma.project.create({
      data: { workspaceId: t.workspaceId, slug: "secret", name: "Secret", visibility: "members" },
    });
    await runOp(t.ctx, { op: "meeting.projectsBy", by: "participants" });
    const participant = asParticipant(t, t.memberId);
    expect((await loadSnapshot(participant)).projectChoices?.map((p) => p.name)).not.toContain("Secret");
    await expect(runOp(participant, { op: "project.follow", projectId: hidden.id })).rejects.toMatchObject({ key: "notFound" });
  });
});

describe("the portfolio", () => {
  it("creates projects with their lead as a member, and keeps items when a project is deleted", async () => {
    const w = await workspace(`portfolio-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const created = await createProject(t.ctx.ws, { name: "Billing API", memberIds: [t.memberId], targetDate: "2030-06-30" });
    expect(created.slug).toBe("billing-api");
    expect(await createProject(t.ctx.ws, { name: "Billing API" })).toMatchObject({ slug: "billing-api-2" });
    const members = await prisma.projectMember.findMany({ where: { projectId: created.id } });
    expect(members.map((m) => m.personId).sort()).toEqual([t.hostPersonId, t.memberId].sort());
    const portfolio = await loadPortfolio(t.ctx.ws);
    expect(portfolio.projects.find((p) => p.id === created.id)).toMatchObject({ mine: true, lead: { id: t.hostPersonId } });

    await deleteProject(t.ctx.ws, t.projectId);
    expect(await prisma.checkInItem.findFirstOrThrow({ where: { meetingId: t.meetingId, text: "project work" } })).toMatchObject({
      projectId: null,
    });
  });

  it("shows what meetings said about a project only to people who may read those meetings", async () => {
    const w = await workspace(`timeline-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    await withRound(t);
    // A decision noted on the project's step: read from the notes, not from every session's whole record
    await runOp(t.ctx, { op: "note.set", key: `p:${t.projectId}`, text: "Decision: ship the invoices first" });
    await runOp(t.ctx, { op: "meeting.goto", key: "end" });
    await runOp(t.ctx, { op: "meeting.archive", summary: null, omit: [] });
    const slug = (await prisma.project.findUniqueOrThrow({ where: { id: t.projectId } })).slug;
    const page = await loadProject(t.ctx.ws, slug);
    expect(page?.timeline).toEqual([expect.objectContaining({ sessionId: t.sessionId, headline: "sheet", health: "onTrack" })]);
    expect(page?.timeline[0]?.decisions.join(" ")).toContain("ship the invoices first");
    expect(page?.timeline[0]?.items.map((i) => i.text)).toEqual(["project work"]);

    // A member of the workspace who is not in the meeting sees the project, not what the meeting said
    const reader = await prisma.person.create({ data: { workspaceId: t.workspaceId, email: `r@${w.ws.slug}.test`, firstName: "Reader" } });
    const outside = asParticipant(t, reader.id).ws;
    const theirs = await loadProject(outside, slug);
    expect(theirs?.project.name).toBeTruthy();
    expect(theirs?.timeline).toEqual([]);
    expect(theirs?.canManage).toBe(false);
  });
});

describe("programmes and rights per project (Enterprise)", () => {
  /** The workspace context of a fixture, on a plan of the cloud */
  const onPlan = (t: Fixture, plan: string) => ({ ...t.ctx.ws, workspace: { ...t.ctx.ws.workspace, plan } });

  it("nest projects three levels deep at most, never in themselves, and only with Enterprise", async () => {
    process.env.RONDE_CLOUD = "1";
    try {
      const w = await workspace(`programmes-${Date.now().toString(36)}`);
      const t = await meeting(w, "Weekly");
      const ent = onPlan(t, "enterprise");
      const top = await createProject(ent, { name: "Customers" });
      const mid = await createProject(ent, { name: "Portal", parentId: top.id });
      const low = await createProject(ent, { name: "Login", parentId: mid.id });
      expect((await prisma.project.findUniqueOrThrow({ where: { id: low.id } })).parentId).toBe(mid.id);
      await expect(createProject(ent, { name: "Too deep", parentId: low.id })).rejects.toMatchObject({ key: "projectProgramme" });
      await expect(updateProject(ent, top.id, { name: "Customers", parentId: low.id })).rejects.toMatchObject({ key: "projectProgramme" });
      const page = await loadProject(ent, "customers");
      expect(page?.children.map((c) => c.name)).toEqual(["Portal"]);
      // Without the plan, the programme asked for is left out
      const free = await createProject(onPlan(t, "community"), { name: "Loose", parentId: top.id });
      expect((await prisma.project.findUniqueOrThrow({ where: { id: free.id } })).parentId).toBeNull();
    } finally {
      delete process.env.RONDE_CLOUD;
    }
  });

  it("hide a private project from people outside it, and let its members edit it when allowed", async () => {
    process.env.RONDE_CLOUD = "1";
    try {
      const w = await workspace(`private-${Date.now().toString(36)}`);
      const t = await meeting(w, "Weekly");
      const ent = onPlan(t, "enterprise");
      const secret = await createProject(ent, { name: "Acquisition", visibility: "members", memberIds: [t.memberId] });
      const outsider = await prisma.person.create({ data: { workspaceId: t.workspaceId, email: `o@${w.ws.slug}.test`, firstName: "Out" } });
      const outside = { ...asParticipant(t, outsider.id).ws, workspace: ent.workspace };
      expect((await loadPortfolio(outside)).projects.map((p) => p.name)).not.toContain("Acquisition");
      expect(await loadProject(outside, "acquisition")).toBeNull();
      // A member edits it once the lead allows it
      const member = { ...asParticipant(t, t.memberId).ws, workspace: ent.workspace };
      expect((await loadProject(member, "acquisition"))?.canManage).toBe(false);
      await updateProject(ent, secret.id, { name: "Acquisition", memberIds: [t.memberId], visibility: "members", membersEdit: true });
      expect((await loadProject(member, "acquisition"))?.canManage).toBe(true);
      await updateProject(member, secret.id, { name: "Acquisition of Globex", memberIds: [t.memberId], visibility: "workspace" });
      // The member renamed it, but who sees it stays the lead's decision
      expect(await prisma.project.findUniqueOrThrow({ where: { id: secret.id } })).toMatchObject({
        name: "Acquisition of Globex",
        visibility: "members",
      });
    } finally {
      delete process.env.RONDE_CLOUD;
    }
  });
});

describe("found in review", () => {
  it("keeps following an archived project when the others are reordered, and frees what was written about it", async () => {
    const w = await workspace(`archived-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const other = await prisma.project.create({ data: { workspaceId: t.workspaceId, slug: "other", name: "Other" } });
    await runOp(t.ctx, { op: "meeting.projects", projectIds: [t.projectId, other.id] });
    const { archiveProject } = await import("@/lib/server/projects");
    await archiveProject(t.ctx.ws, t.projectId, true);
    // Archiving gives the items back to people's own tab and drops the sheet being written
    expect((await prisma.checkInItem.findFirstOrThrow({ where: { meetingId: t.meetingId, text: "project work" } })).projectId).toBeNull();
    expect(await prisma.projectUpdate.count({ where: { projectId: t.projectId, sessionId: null } })).toBe(0);
    // The settings only list the other project; saving them keeps the archived one followed
    await runOp(t.ctx, { op: "meeting.projects", projectIds: [other.id] });
    expect((await prisma.meetingProject.findMany({ where: { meetingId: t.meetingId } })).map((r) => r.projectId).sort()).toEqual(
      [t.projectId, other.id].sort(),
    );
  });

  it("saves only what changed in a sheet, so two people writing it do not erase each other", async () => {
    const w = await workspace(`twice-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    await runOp(asParticipant(t, t.memberId), { op: "project.sheet", projectId: t.projectId, headline: "Shipped v2" });
    await runOp(t.ctx, { op: "project.sheet", projectId: t.projectId, health: "atRisk" });
    expect(await prisma.projectUpdate.findFirstOrThrow({ where: { meetingId: t.meetingId, sessionId: null } })).toMatchObject({
      health: "atRisk",
      headline: "Shipped v2",
    });
  });

  it("archives the items of a section removed since, with the person presented", async () => {
    const w = await workspace(`orphans-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    await prisma.checkInItem.create({
      data: {
        workspaceId: t.workspaceId,
        meetingId: t.meetingId,
        personId: t.memberId,
        sectionKey: "gone",
        role: "custom",
        text: "orphan",
      },
    });
    await runOp(t.ctx, { op: "meeting.goto", key: "end" });
    await runOp(t.ctx, { op: "meeting.archive", summary: null, omit: [] });
    expect((await prisma.checkInItem.findFirstOrThrow({ where: { meetingId: t.meetingId, text: "orphan" } })).sessionId).toBe(t.sessionId);
  });
});
