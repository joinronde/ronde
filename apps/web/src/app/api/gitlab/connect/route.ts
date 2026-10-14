import { type NextRequest, NextResponse } from "next/server";
import { connectUrl } from "@/lib/server/gitlab-oauth";
import { meetingContext } from "@/lib/server/meeting/context";
import { publicUrl } from "@/lib/server/public-url";

// "Connect with GitLab" from a meeting's settings: on to GitLab's consent page, with a signed state
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const ctx = await meetingContext(q.get("w") ?? "", q.get("m") ?? "");
  if (!ctx) return new Response(null, { status: 404 });
  const back = async (result: string) =>
    NextResponse.redirect(await publicUrl(`/w/${ctx.ws.workspace.slug}/m/${ctx.meeting.id}/settings?gitlab=${result}#integrations`));
  if (!ctx.can("meeting.configure")) return back("denied");
  try {
    return NextResponse.redirect(await connectUrl(ctx.meeting.id, ctx.ws.user.id));
  } catch (e) {
    console.error("[gitlab] connect", e);
    return back("failed");
  }
}
