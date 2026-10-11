import { type NextRequest, NextResponse } from "next/server";
import { workspaceContext } from "@/lib/server/authz";
import { publicUrl } from "@/lib/server/public-url";
import { installUrl } from "@/lib/server/slack";

// "Add to Slack" from the workspace settings: on to Slack's consent page, with a signed state
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("w") ?? "";
  const ctx = await workspaceContext(slug);
  if (!ctx) return new Response(null, { status: 404 });
  const back = async (result: string) => NextResponse.redirect(await publicUrl(`/w/${ctx.workspace.slug}/settings?slack=${result}#slack`));
  if (!ctx.can("connectors.manage")) return back("denied");
  try {
    return NextResponse.redirect(await installUrl(ctx));
  } catch (e) {
    console.error("[slack] install", e);
    return back("failed");
  }
}
