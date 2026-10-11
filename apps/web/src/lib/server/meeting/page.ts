import "server-only";
import { notFound, redirect } from "next/navigation";
import { pageUser } from "../authz";
import { type MeetingCtx, meetingContext } from "./context";

export type MeetingPageParams = { params: Promise<{ ws: string; meeting: string }> };

/** For meeting pages: the context, a redirect to sign in, or a 404 for a meeting the user cannot see */
export async function pageMeeting({ params }: MeetingPageParams): Promise<MeetingCtx> {
  const { ws, meeting } = await params;
  await pageUser(`/w/${ws}/m/${meeting}`);
  const ctx = await meetingContext(ws, meeting);
  if (!ctx) notFound();
  return ctx;
}

/** Page where each person lands: the control room for hosts, "My screen" for everyone else */
export const homeOf = (ctx: MeetingCtx) => `${ctx.links.path}/${ctx.viewer.isHost ? "control" : "me"}`;

/** Host pages (control room, settings, stats, history): others are sent to "My screen" */
export function requireHostPage(ctx: MeetingCtx) {
  if (!ctx.viewer.isHost) redirect(`${ctx.links.path}/me`);
}

/** "My screen" is where people fill in their check-in: a host who does not take part goes to the control room */
export function hostWithoutCheckIn(ctx: MeetingCtx) {
  if (ctx.viewer.isHost && !ctx.viewer.memberId) redirect(`${ctx.links.path}/control`);
}
