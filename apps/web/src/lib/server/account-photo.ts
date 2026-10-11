import "server-only";
import { prisma, scoped } from "@ronde/db";
import { publish } from "./bus";
import { OpError } from "./errors";
import { AVATAR_MAX_BYTES, sniffImage } from "./images";

// A person's photo set from their account: it goes on their card in every workspace they belong to

/** The workspaces where the person has a card (active memberships of workspaces still there) */
const cards = (userId: string) =>
  prisma.workspaceMember.findMany({
    where: { userId, status: "active", workspace: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: {
      workspaceId: true,
      personId: true,
      workspace: { select: { slug: true } },
      person: { select: { color: true, avatar: { select: { updatedAt: true } } } },
    },
  });

/** The photo shown on the account page: the first one of the person's cards; null without any card */
export async function accountPhoto(userId: string): Promise<{ url: string | null; color: number } | null> {
  const list = await cards(userId);
  if (!list.length) return null;
  const withPhoto = list.find((c) => c.person.avatar);
  return {
    url: withPhoto
      ? `/api/w/${withPhoto.workspace.slug}/avatar/${withPhoto.personId}?v=${withPhoto.person.avatar!.updatedAt.getTime()}`
      : null,
    color: list[0]!.person.color,
  };
}

/** Puts the photo on every card of the person (null: removes it from all); returns how many cards changed */
export async function setAccountPhoto(userId: string, data: Uint8Array<ArrayBuffer> | null): Promise<number> {
  let type: string | null = null;
  if (data) {
    if (!data.length || data.length > AVATAR_MAX_BYTES) throw new OpError("avatarTooLarge", { max: AVATAR_MAX_BYTES / 1000 });
    type = sniffImage(data);
    if (!type) throw new OpError("avatarFormat");
  }
  const list = await cards(userId);
  for (const c of list) {
    const db = scoped(prisma, c.workspaceId);
    if (data && type)
      await db.personAvatar.upsert({
        where: { personId: c.personId },
        create: { personId: c.personId, workspaceId: c.workspaceId, data, type },
        update: { data, type },
      });
    else await db.personAvatar.deleteMany({ where: { personId: c.personId } });
  }
  // Shown in every meeting of the person
  if (list.length) await publish("*", { kind: "state" });
  return list.length;
}
