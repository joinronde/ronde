import { prisma } from "@ronde/db";
import { type NextRequest, NextResponse } from "next/server";
import { workspaceContext } from "@/lib/server/authz";
import { publicUrl } from "@/lib/server/public-url";
import { finishInstall, readInstallState } from "@/lib/server/slack";

// Slack's answer to "Add to Slack": the code is exchanged only for the administrator who started it, in the
// browser where they are signed in (the signed state names them)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const state = readInstallState(q.get("state") ?? "");
  const ws = state ? await prisma.workspace.findUnique({ where: { id: state.workspaceId }, select: { slug: true } }) : null;
  if (!state || !ws) return NextResponse.redirect(await publicUrl("/"));
  const back = async (result: string) => NextResponse.redirect(await publicUrl(`/w/${ws.slug}/settings?slack=${result}#slack`));
  const ctx = await workspaceContext(ws.slug);
  if (!ctx || ctx.user.id !== state.userId || !ctx.can("connectors.manage")) return back("denied");
  const code = q.get("code");
  if (!code) return back("cancelled");
  try {
    await finishInstall(ctx, code);
    return back("connected");
  } catch (e) {
    console.error("[slack] installation", e);
    return back("failed");
  }
}
