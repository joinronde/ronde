import "server-only";
import { can, type MeetingRole, type Permission } from "@ronde/core/permissions";
import { localDate } from "@ronde/core/schedule";
import type { MeetingContext as MeetingLinks, Viewer } from "@ronde/core/types";
import type { Meeting } from "@ronde/db";
import { cache } from "react";
import { BASE_PATH } from "../../shared/base-path";
import { standsInAsHost } from "../absences";
import { requireUser, type WorkspaceContext, workspaceContext } from "../authz";
import { AccessError } from "../errors";

/** Everything an operation or a page needs to know about the meeting and the person viewing it */
export interface MeetingCtx {
  ws: WorkspaceContext;
  /** The workspace, as operations of modules see it */
  workspace: WorkspaceContext["workspace"];
  meeting: Meeting;
  /** Role of the viewer in the meeting; null for workspace admins who are not participants */
  role: MeetingRole | null;
  viewer: Viewer;
  links: MeetingLinks;
  can: (permission: Permission) => boolean;
}

export const meetingLinks = (slug: string, name: string, meetingId: string): MeetingLinks => ({
  workspace: { slug, name },
  meetingId,
  path: `/w/${slug}/m/${meetingId}`,
  api: `${BASE_PATH}/api/w/${slug}/m/${meetingId}`,
  workspaceApi: `${BASE_PATH}/api/w/${slug}`,
});

/**
 * The meeting as the signed-in user may see it: participants, and workspace owners and admins (who act as
 * hosts of every meeting). Null for everyone else, so a meeting of another team looks like it does not exist.
 */
export const meetingContext = cache(async (slug: string, meetingId: string): Promise<MeetingCtx | null> => {
  const ws = await workspaceContext(slug);
  if (!ws) return null;
  const meeting = await ws.db.meeting.findFirst({ where: { id: meetingId, archivedAt: null } });
  if (!meeting) return null;
  const participant = await ws.db.meetingParticipant.findFirst({
    where: { meetingId, personId: ws.member.personId },
    select: { role: true },
  });
  // Someone named by an absent host runs their meetings meanwhile
  const standsIn =
    participant?.role !== "host" &&
    (await standsInAsHost(ws.db, meetingId, ws.member.personId, localDate(Date.now(), meeting.timezone ?? ws.workspace.timezone)));
  const role = standsIn ? "host" : (participant?.role ?? null);
  const principal = { ...ws.principal, meetingRole: role };
  const allowed = (permission: Permission) => can(principal, permission, ws.workspace.settings);
  if (!allowed("meeting.read")) return null;
  const viewer: Viewer = {
    userId: ws.user.id,
    personId: ws.member.personId,
    email: ws.user.email,
    name: ws.user.name || ws.user.email,
    memberId: role && role !== "observer" ? ws.member.personId : null,
    isHost: allowed("session.run"),
    isAdmin: allowed("meeting.configure"),
  };
  return {
    ws,
    workspace: ws.workspace,
    meeting,
    role,
    viewer,
    links: meetingLinks(ws.workspace.slug, ws.workspace.name, meeting.id),
    can: allowed,
  };
});

/** For API routes: the meeting context; 401 signed out, 403 unknown, not visible or not allowed */
export async function requireMeeting(slug: string, meetingId: string, permission?: Permission): Promise<MeetingCtx> {
  await requireUser();
  const ctx = await meetingContext(slug, meetingId);
  if (!ctx) throw new AccessError(403, "accessDenied");
  if (permission && !ctx.can(permission)) throw new AccessError(403, permission === "session.run" ? "hostOnly" : "accessDenied");
  return ctx;
}
