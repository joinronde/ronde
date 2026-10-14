import "server-only";
import { prisma } from "@ronde/db";
import { env } from "../env";
import { deliver, meetingPeople } from "../inbox";
import { minutesPayload, notifyEvent } from "../notify/dispatch";
import { publishSession } from "../wikis";
import { closeDueSessions } from "./close-due";

// A live session nobody closed (a host who left the tab open, a meeting that ran over and was forgotten): after a
// while it closes by itself, its minutes published as the host would have, so the next session can be prepared

/** Job: publishes the minutes of the live sessions started more than the allowed hours ago */
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
    inside: async (db, meetingId) => {
      await deliver(db, due.find((d) => d.meetingId === meetingId)!.workspaceId, {
        to: await meetingPeople(db, meetingId),
        kind: "minutes.published",
        meetingId,
        href: `/m/${meetingId}/history`,
      });
    },
    after: async (meetingId, session, record) => {
      await notifyEvent(meetingId, "minutes.published", session.id, minutesPayload(record, session));
      await publishSession(session.id);
    },
    what: "forgotten session",
  });
}
