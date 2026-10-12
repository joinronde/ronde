import { prisma } from "@ronde/db";
import { describe, expect, it } from "vitest";
import { deleteAccount, exportAccount } from "@/lib/server/account-data";
import { removePerson } from "@/lib/server/workspaces";
import { meeting, workspace } from "./fixtures";

// A person's rights over their data: all of it as a file, their account deleted, their profile erased from a
// workspace while what they said stays the team's

const run = Date.now().toString(36);
let n = 0;

/** A member with an account in the fixture's workspace, who spoke at an archived session and owns an action */
async function member() {
  const f = await meeting(await workspace(`data-${run}-${++n}`), "Weekly");
  const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `lena-${run}-${n}@data.test`, name: "Lena Fischer" } });
  await prisma.person.update({
    where: { id: f.memberId },
    data: { userId: user.id, firstName: "Lena", lastName: "Fischer", phone: "+33612345678", birthday: "1990-04-02", email: user.email },
  });
  await prisma.workspaceMember.create({ data: { workspaceId: f.workspaceId, userId: user.id, personId: f.memberId, role: "member" } });
  await prisma.absence.create({
    data: { workspaceId: f.workspaceId, personId: f.memberId, from: "2030-01-01", to: "2030-01-05", note: "sick leave" },
  });
  await prisma.session.create({
    data: {
      workspaceId: f.workspaceId,
      meetingId: f.meetingId,
      date: "2026-01-05",
      status: "archived",
      record: { names: { [f.memberId]: "Lena Fischer" }, participants: [{ id: f.memberId, name: "Lena Fischer" }], absent: [] },
    },
  });
  return { f, user };
}

describe("a person's data", () => {
  it("comes as one file: the account and, in each workspace, the profile and what they wrote", async () => {
    const { f, user } = await member();
    const data = await exportAccount(user.id);
    expect(data.account).toMatchObject({ email: user.email, name: "Lena Fischer" });
    expect(data.workspaces[0]).toMatchObject({
      role: "member",
      profile: { firstName: "Lena", phone: "+33612345678", birthday: "1990-04-02" },
      checkInItems: expect.arrayContaining([expect.objectContaining({ text: "project work" })]),
      absences: [expect.objectContaining({ note: "sick leave" })],
    });
    expect(data.workspaces[0]!.workspace.slug).toBe(f.ctx.ws.workspace.slug);
  });

  it("go with the account, which their workspace's history keeps signed by a former member", async () => {
    const { f, user } = await member();
    const said = await prisma.checkInItem.count({ where: { personId: f.memberId } });
    await expect(deleteAccount(user, "someone@else.test")).rejects.toMatchObject({ key: "confirmationMismatch" });
    await deleteAccount(user, user.email.toUpperCase());
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    const card = await prisma.person.findUniqueOrThrow({ where: { id: f.memberId } });
    expect(card).toMatchObject({ firstName: "Former member", lastName: "", phone: null, birthday: null, userId: null, active: false });
    expect(card.email).toMatch(/@erased\.invalid$/);
    expect(await prisma.absence.count({ where: { personId: f.memberId } })).toBe(0);
    expect(await prisma.meetingParticipant.count({ where: { personId: f.memberId } })).toBe(0);
    // What they said stays the team's
    expect(await prisma.checkInItem.count({ where: { personId: f.memberId } })).toBe(said);
    const archived = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "archived" } });
    expect(JSON.stringify(archived.record)).not.toContain("Lena");
  });

  it("cannot go while they are the last owner of a workspace", async () => {
    const w = await workspace(`data-owner-${run}`);
    await expect(deleteAccount({ id: w.user.id, email: w.user.email }, w.user.email)).rejects.toMatchObject({
      key: "accountOwnsWorkspaces",
    });
    expect(await prisma.user.findUnique({ where: { id: w.user.id } })).not.toBeNull();
  });

  it("are erased from a workspace by its administrator, the team's actions kept", async () => {
    const { f } = await member();
    await prisma.action.update({ where: { id: f.actionId }, data: { ownerId: f.memberId } });
    await removePerson(f.ctx.ws, f.memberId);
    expect(await prisma.action.findUnique({ where: { id: f.actionId } })).toMatchObject({ ownerId: f.memberId });
    expect(await prisma.person.findUniqueOrThrow({ where: { id: f.memberId } })).toMatchObject({
      firstName: "Former member",
      userId: null,
    });
    expect(await prisma.workspaceMember.count({ where: { personId: f.memberId } })).toBe(0);
  });
});
