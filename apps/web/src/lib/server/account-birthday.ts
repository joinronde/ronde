import "server-only";
import { prisma } from "@ronde/db";
import { OpError } from "./errors";
import { BIRTHDAY } from "./workspaces";

// A person's birthday, set from their account: it goes on their card in every workspace, and is only asked for
// when one of their meetings celebrates birthdays

/** The birthday on the person's cards (the first one set), and whether a meeting of theirs celebrates birthdays */
export async function accountBirthday(userId: string): Promise<{ birthday: string | null; offered: boolean }> {
  const [cards, celebrating] = await Promise.all([
    prisma.person.findMany({ where: { userId, deprovisionedAt: null }, select: { birthday: true } }),
    prisma.moduleInstallation.count({
      where: { moduleId: "birthdays", enabled: true, meeting: { archivedAt: null, participants: { some: { person: { userId } } } } },
    }),
  ]);
  return { birthday: cards.find((c) => c.birthday)?.birthday ?? null, offered: celebrating > 0 };
}

/** "MM-DD" on every card of the person, or none */
export async function setAccountBirthday(userId: string, birthday: string | null): Promise<void> {
  if (birthday !== null && !BIRTHDAY.test(birthday)) throw new OpError("invalidRequest", { details: "birthday" });
  await prisma.person.updateMany({ where: { userId, deprovisionedAt: null }, data: { birthday } });
}
