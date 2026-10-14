import { prisma } from "@ronde/db";
import { type NextRequest, NextResponse } from "next/server";
import { workspaceContext } from "@/lib/server/authz";
import { saveOAuthConnection } from "@/lib/server/forges";
import { connectBack, exchangeCode, gitlabOAuthOn, readConnectState } from "@/lib/server/gitlab-oauth";
import { meetingContext } from "@/lib/server/meeting/context";
import { publicUrl } from "@/lib/server/public-url";

// GitLab's answer to "Connect with GitLab": the code is exchanged only for the person who started it, in the
// browser where they are signed in (the signed state names them), and kept in the connection it was for
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const state = readConnectState(q.get("state") ?? "");
  const workspace = state ? await prisma.workspace.findUnique({ where: { id: state.workspaceId }, select: { slug: true } }) : null;
  if (!state || !workspace) return NextResponse.redirect(await publicUrl("/"));
  const back = async (result: string) => NextResponse.redirect(await connectBack(workspace.slug, state.meetingId, result));
  // The person who started it, still allowed to set it up, on an edition that has the GitLab module
  const meeting = state.meetingId ? await meetingContext(workspace.slug, state.meetingId) : null;
  const ctx = state.meetingId ? meeting?.ws : await workspaceContext(workspace.slug);
  const allowed = state.meetingId ? !!meeting?.can("meeting.configure") : !!ctx?.can("connectors.manage");
  if (!ctx || ctx.user.id !== state.userId || !allowed || !gitlabOAuthOn()) return back("denied");
  const code = q.get("code");
  if (!code) return back("cancelled");
  try {
    await saveOAuthConnection(ctx, state, await exchangeCode(code));
    return back("connected");
  } catch (e) {
    console.error("[gitlab] oauth", e);
    return back("failed");
  }
}
