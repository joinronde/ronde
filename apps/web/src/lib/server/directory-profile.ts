import "server-only";
import type { DirectoryProfile } from "@ronde/core/directory";
import { prisma } from "@ronde/db";
import { ensureTeam } from "@ronde/db/teams";

// On its own, away from the sign-in code: it needs the database only (importing the identity code loads the whole
// authentication, which reads the identity code back while it is still loading)

/**
 * What the company directory says of someone, copied to their card in the workspace: the phone and the team
 * follow the directory (its team made if missing), a birthday the person entered stays theirs
 */
export async function applyProfile(email: string, workspaceId: string, profile: DirectoryProfile): Promise<void> {
  const person = await prisma.person.findFirst({
    where: { workspaceId, email: { equals: email.trim(), mode: "insensitive" }, deprovisionedAt: null },
    select: { id: true, birthday: true },
  });
  if (!person) return;
  const team = profile.team ? await ensureTeam(prisma, workspaceId, profile.team) : undefined;
  const data = {
    ...(profile.phone ? { phone: profile.phone } : {}),
    ...(team ? { jobCategoryId: team } : {}),
    ...(profile.birthday && !person.birthday ? { birthday: profile.birthday } : {}),
  };
  if (Object.keys(data).length) await prisma.person.update({ where: { id: person.id }, data });
}
