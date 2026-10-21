import "server-only";
import { prisma } from "@ronde/db";
import { env } from "../env";
import { closeDueSessions } from "./close-due";

// A live session nobody closed (a host who left the tab open, a meeting that ran over and was forgotten): after a
// while it closes by itself so the team can prepare the next session. Its minutes wait as a draft in the history,
// for the hosts to finish and publish (they are reminded of it: drafts.ts)

/** Job: archives the live sessions started more than the allowed hours ago, their minutes as drafts */
export async function closeStaleSessions(now = new Date(), hours = env.autoCloseHours()): Promise<number> {
  if (!hours) return 0;
  const before = new Date(now.getTime() - hours * 3_600_000);
  const due = await prisma.session.findMany({
    where: {
      status: "current",
      startedAt: { lte: before },
      meeting: { archivedAt: null, workspace: { deletedAt: null, suspendedAt: null } },
    },
    include: { meeting: { include: { workspace: true } } },
  });
  return closeDueSessions(due, {
    still: { startedAt: { lte: before } },
    data: (session) => ({ endedAt: session.endedAt ?? now }),
    draft: true,
    what: "forgotten session",
  });
}
