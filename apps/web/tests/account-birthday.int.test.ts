import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { accountBirthday, setAccountBirthday } from "@/lib/server/account-birthday";
import { type Fixture, meeting, workspace } from "./fixtures";

// A birthday set from the account: asked for only when one of the person's meetings celebrates birthdays, written
// on their card in every workspace, day and month only

let a: Fixture;
let userId: string;

beforeAll(async () => {
  const w = await workspace("bday-a");
  userId = w.user.id;
  a = await meeting(w, "Weekly");
  // The same account in a second workspace, with its own card
  const ws2 = await prisma.workspace.create({ data: { slug: "bday-b", name: "B" } });
  const card = await prisma.person.create({ data: { workspaceId: ws2.id, userId, email: w.user.email, firstName: "Host" } });
  await prisma.workspaceMember.create({ data: { workspaceId: ws2.id, userId, personId: card.id, role: "member" } });
});

const birthdays = (on: boolean) =>
  prisma.moduleInstallation.upsert({
    where: { meetingId_moduleId: { meetingId: a.meetingId, moduleId: "birthdays" } },
    create: { workspaceId: a.workspaceId, meetingId: a.meetingId, moduleId: "birthdays", enabled: on, config: {} },
    update: { enabled: on },
  });

describe("birthday from the account", () => {
  it("is only asked for when a meeting of the person celebrates birthdays", async () => {
    await birthdays(false);
    expect(await accountBirthday(userId)).toEqual({ birthday: null, offered: false });
    await birthdays(true);
    expect((await accountBirthday(userId)).offered).toBe(true);
  });

  it("goes on every card of the person", async () => {
    await setAccountBirthday(userId, "02-29");
    const cards = await prisma.person.findMany({ where: { userId } });
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.birthday === "02-29")).toBe(true);
    expect((await accountBirthday(userId)).birthday).toBe("02-29");
    await setAccountBirthday(userId, null);
    expect((await prisma.person.findMany({ where: { userId } })).every((c) => c.birthday === null)).toBe(true);
  });

  it("refuses anything but a day and a month", async () => {
    for (const bad of ["1990-02-14", "13-01", "02-32", "2-14"])
      await expect(setAccountBirthday(userId, bad)).rejects.toMatchObject({ key: "invalidRequest" });
  });
});
