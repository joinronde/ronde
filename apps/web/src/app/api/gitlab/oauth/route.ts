import { prisma } from "@ronde/db";
import { type NextRequest, NextResponse } from "next/server";
import { exchangeCode, readConnectState, saveGrant } from "@/lib/server/gitlab-oauth";
import { meetingContext } from "@/lib/server/meeting/context";
import { publicUrl } from "@/lib/server/public-url";

// GitLab's answer to "Connect with GitLab": the code is exchanged only for the person who started it, in the
// browser where they are signed in (the signed state names them), and kept in the meeting's GitLab module
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const state = readConnectState(q.get("state") ?? "");
  const meeting = state
    ? await prisma.meeting.findUnique({ where: { id: state.meetingId }, select: { id: true, workspace: { select: { slug: true } } } })
    : null;
  if (!state || !meeting) return NextResponse.redirect(await publicUrl("/"));
  const back = async (result: string) =>
    NextResponse.redirect(await publicUrl(`/w/${meeting.workspace.slug}/m/${meeting.id}/settings?gitlab=${result}#integrations`));
  const ctx = await meetingContext(meeting.workspace.slug, meeting.id);
  if (!ctx || ctx.ws.user.id !== state.userId || !ctx.can("meeting.configure")) return back("denied");
  const code = q.get("code");
  if (!code) return back("cancelled");
  try {
    await saveGrant(ctx.ws.db, ctx.ws.workspace.id, ctx.meeting.id, await exchangeCode(code));
    return back("connected");
  } catch (e) {
    console.error("[gitlab] oauth", e);
    return back("failed");
  }
}
