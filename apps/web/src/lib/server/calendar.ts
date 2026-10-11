import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { type IcsMeeting, icsCalendar } from "@ronde/core/ics";
import { prisma, scoped } from "@ronde/db";
import { env } from "./env";
import { loadSchedule, timeZoneOf } from "./meeting/schedule";
import { publicUrl } from "./public-url";

// Calendar feeds (ICS): a secret link per user, for one meeting or for every meeting they take part in.
// Only the hash of the token is stored; creating a new link revokes the previous one.

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createFeedLink(userId: string, meetingId: string | null): Promise<string> {
  await prisma.feedToken.deleteMany({ where: { userId, meetingId } });
  const token = randomBytes(24).toString("base64url");
  await prisma.feedToken.create({ data: { userId, meetingId, tokenHash: hash(token) } });
  return publicUrl(`/api/calendar/${token}.ics`);
}

/** Meetings a user may still see: they take part in them, or administer their workspace */
async function visibleMeetings(userId: string, meetingId: string | null) {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId, status: "active", workspace: { deletedAt: null } },
    select: { workspaceId: true, personId: true, role: true, workspace: { select: { slug: true, timezone: true } } },
  });
  const out = [];
  for (const ms of memberships) {
    const admin = ms.role === "owner" || ms.role === "admin";
    const meetings = await prisma.meeting.findMany({
      where: {
        workspaceId: ms.workspaceId,
        archivedAt: null,
        // The sample meeting stays in Ronde: nothing of it in a real calendar
        sample: false,
        ...(meetingId ? { id: meetingId } : {}),
        // The personal feed lists the meetings people take part in, admins included
        ...(meetingId && admin ? {} : { participants: { some: { personId: ms.personId } } }),
      },
    });
    out.push(...meetings.map((m) => ({ meeting: m, workspace: ms.workspace })));
  }
  return out;
}

/** The ICS document of a feed link, or null for an unknown or revoked link */
export async function feedDocument(token: string): Promise<string | null> {
  const feed = await prisma.feedToken.findUnique({ where: { tokenHash: hash(token) }, include: { user: { select: { id: true } } } });
  if (!feed) return null;
  const visible = await visibleMeetings(feed.user.id, feed.meetingId);
  if (feed.meetingId && !visible.length) return null;
  const base = env.appUrl();
  const meetings: IcsMeeting[] = [];
  for (const { meeting, workspace } of visible) {
    const db = scoped(prisma, meeting.workspaceId);
    const { rules, exceptions } = await loadSchedule(db, meeting.id);
    // A session prepared on a date picked by hand, outside the schedule
    const handPicked = await db.session.findFirst({ where: { meetingId: meeting.id, status: "current", occurrenceKey: null } });
    meetings.push({
      id: meeting.id,
      name: meeting.name,
      timeZone: timeZoneOf(meeting, workspace),
      rules,
      exceptions,
      url: base ? `${base}/w/${workspace.slug}/m/${meeting.id}` : "",
      description: meeting.description || undefined,
      extra: handPicked ? [{ date: handPicked.date, time: handPicked.time, durationMin: handPicked.durationMin }] : [],
    });
  }
  return icsCalendar(feed.meetingId ? (meetings[0]?.name ?? "Ronde") : "Ronde", meetings);
}
