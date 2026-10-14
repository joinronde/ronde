import { type NextRequest, NextResponse } from "next/server";
import { workspaceContext } from "@/lib/server/authz";
import { connectBack, connectUrl } from "@/lib/server/gitlab-oauth";
import { meetingContext } from "@/lib/server/meeting/context";

// "Connect with GitLab", from the workspace's settings (?w=) or a meeting's (?w=&m=), for a new connection or one
// connected again (&c=): on to GitLab's consent page, with a signed state
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const slug = q.get("w") ?? "";
  const meetingId = q.get("m") || null;
  const connectionId = q.get("c") || null;
  let target: { workspaceId: string; userId: string; allowed: boolean } | null = null;
  if (meetingId) {
    const ctx = await meetingContext(slug, meetingId);
    if (ctx) target = { workspaceId: ctx.ws.workspace.id, userId: ctx.ws.user.id, allowed: ctx.can("meeting.configure") };
  } else {
    const ctx = await workspaceContext(slug);
    if (ctx) target = { workspaceId: ctx.workspace.id, userId: ctx.user.id, allowed: ctx.can("connectors.manage") };
  }
  if (!target) return new Response(null, { status: 404 });
  const back = async (result: string) => NextResponse.redirect(await connectBack(slug, meetingId, result));
  if (!target.allowed) return back("denied");
  try {
    return NextResponse.redirect(await connectUrl({ workspaceId: target.workspaceId, meetingId, connectionId, userId: target.userId }));
  } catch (e) {
    console.error("[gitlab] connect", e);
    return back("failed");
  }
}
