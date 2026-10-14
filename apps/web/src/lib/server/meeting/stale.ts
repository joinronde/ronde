import "server-only";
import { prisma, scoped } from "@ronde/db";
import type { WorkspaceSettings } from "../authz";
import { publish } from "../bus";
import { env } from "../env";
import { deliver, meetingPeople } from "../inbox";
import { minutesPayload, notifyEvent } from "../notify/dispatch";
import { publishSession } from "../wikis";
import { archiveSession } from "./session";

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
  let closed = 0;
  for (const row of due) {
    try {
      const { meeting, ...session } = row;
      const record = await scoped(prisma, row.workspaceId).$transaction(
        async (db) => {
          // Taken once: a host publishing at the same moment, or another replica, finds it already done
          const { count } = await db.session.updateMany({
            where: { id: session.id, status: "current", startedAt: { lte: before } },
            data: { rev: { increment: 1 }, endedAt: session.endedAt ?? now },
          });
          if (!count) return null;
          const fresh = await db.session.findFirstOrThrow({ where: { id: session.id } });
          const workspace = { ...meeting.workspace, settings: (meeting.workspace.settings ?? {}) as WorkspaceSettings };
          const record = await archiveSession(db, { meeting, ws: { workspace } }, fresh, { summary: null, omit: [] });
          await deliver(db, row.workspaceId, {
            to: await meetingPeople(db, meeting.id),
            kind: "minutes.published",
            meetingId: meeting.id,
            href: `/m/${meeting.id}/history`,
          });
          return record;
        },
        { timeout: 30_000 },
      );
      if (!record) continue;
      closed++;
      await publish(meeting.id, { kind: "history" });
      await publish(meeting.id, { kind: "state" });
      await notifyEvent(meeting.id, "minutes.published", session.id, minutesPayload(record, session));
      await publishSession(session.id);
    } catch (e) {
      console.error(`[jobs] closing the forgotten session ${row.id} failed`, e);
    }
  }
  return closed;
}
