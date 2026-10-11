import { NextResponse } from "next/server";
import { authorize } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { requestLocale } from "@/lib/server/locale";
import { searchWorkspace } from "@/lib/server/search";

export const dynamic = "force-dynamic";

// Search of the ⌘K palette (?q=): meetings, people, actions, topics and decisions the person can see
export async function GET(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  try {
    const ctx = await authorize((await params).ws);
    const q = new URL(req.url).searchParams.get("q") ?? "";
    return NextResponse.json({ hits: await searchWorkspace(ctx, q, await requestLocale()) });
  } catch (e) {
    return errorResponse(e);
  }
}
