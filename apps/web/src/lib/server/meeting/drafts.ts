import "server-only";
import { prisma, scoped } from "@ronde/db";
import { env } from "../env";
import { deliver } from "../inbox";

// Minutes left as a draft after the session (the host chose to write them later, or the session closed by itself):
// after a few days, the hosts find a reminder under the bell. Once per draft; nothing is published for them.

/** Job: reminds the hosts of the drafts archived more than the allowed days ago */
export async function remindDrafts(now = new Date(), days = env.draftRemindDays()): Promise<number> {
  if (!days) return 0;
  const before = new Date(now.getTime() - days * 86_400_000);
  const drafts = await prisma.session.findMany({
    where: {
      status: "archived",
      minutesPublishedAt: null,
      draftRemindedAt: null,
      archivedAt: { lte: before },
      meeting: { archivedAt: null, sample: false, workspace: { deletedAt: null, suspendedAt: null } },
    },
    select: { id: true, workspaceId: true, meetingId: true, date: true },
    take: 500,
  });
  let reminded = 0;
  for (const d of drafts) {
    try {
      const db = scoped(prisma, d.workspaceId);
      // Taken once (another replica, the next run)
      const { count } = await db.session.updateMany({ where: { id: d.id, draftRemindedAt: null }, data: { draftRemindedAt: now } });
      if (!count) continue;
      const hosts = await db.meetingParticipant.findMany({
        where: { meetingId: d.meetingId, role: { in: ["host", "cohost"] }, person: { active: true, deprovisionedAt: null } },
        select: { personId: true },
      });
      await deliver(db, d.workspaceId, {
        to: hosts.map((h) => h.personId),
        kind: "minutes.draft",
        meetingId: d.meetingId,
        href: `/m/${d.meetingId}/history`,
      });
      reminded++;
    } catch (e) {
      console.error(`[jobs] reminding the draft of session ${d.id} failed`, e);
    }
  }
  return reminded;
}
