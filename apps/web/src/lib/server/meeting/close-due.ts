import "server-only";
import type { RecordV1 } from "@ronde/core/record";
import { type Prisma, prisma, type ScopedTx, type Session, scoped } from "@ronde/db";
import type { WorkspaceSettings } from "../authz";
import { publish } from "../bus";
import { archiveSession } from "./session";

// Sessions closed by a job rather than by a host (an async meeting at its planned time, a live one forgotten
// open): each taken once, archived with its minutes, the screens told. What differs from one job to the other is
// passed in: which sessions may be taken, what else is done with the archive, and what follows the publication

/** A session due, with its meeting and workspace, as the jobs find them */
export type DueSession = Session & {
  meeting: Prisma.MeetingGetPayload<{ include: { workspace: true } }>;
};

export async function closeDueSessions(
  due: DueSession[],
  o: {
    /** What else must still hold to take it (a host publishing at the same moment, or another replica, wins) */
    still: Prisma.SessionWhereInput;
    /** What changes on the session as it is taken */
    data?: (session: Session) => Prisma.SessionUpdateManyMutationInput;
    /** Done with the archive, in the same transaction */
    inside?: (db: ScopedTx, meetingId: string) => Promise<void>;
    /** Once published: notifications, digests, wikis */
    after: (meetingId: string, session: Session, record: RecordV1) => Promise<void>;
    /** For the logs: "async session", "forgotten session" */
    what: string;
  },
): Promise<number> {
  let closed = 0;
  for (const row of due) {
    try {
      const { meeting, ...session } = row;
      const record = await scoped(prisma, row.workspaceId).$transaction(
        async (db) => {
          // Taken once
          const { count } = await db.session.updateMany({
            where: { id: session.id, status: "current", ...o.still },
            data: { rev: { increment: 1 }, ...o.data?.(session) },
          });
          if (!count) return null;
          const fresh = await db.session.findFirstOrThrow({ where: { id: session.id } });
          const workspace = { ...meeting.workspace, settings: (meeting.workspace.settings ?? {}) as WorkspaceSettings };
          const archived = await archiveSession(db, { meeting, ws: { workspace } }, fresh, { summary: null, omit: [] });
          await o.inside?.(db, meeting.id);
          return archived;
        },
        { timeout: 30_000 },
      );
      if (!record) continue;
      closed++;
      await publish(meeting.id, { kind: "history" });
      await publish(meeting.id, { kind: "state" });
      await o.after(meeting.id, session, record);
    } catch (e) {
      console.error(`[jobs] closing the ${o.what} ${row.id} failed`, e);
    }
  }
  return closed;
}
