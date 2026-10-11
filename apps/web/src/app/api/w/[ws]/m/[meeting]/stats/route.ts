import { NextResponse } from "next/server";
import { meetingRoute } from "@/lib/server/meeting/route";
import { meetingStats } from "@/lib/server/meeting/stats";

export const dynamic = "force-dynamic";

// Stats of the meeting, computed over its archived sessions
export const GET = meetingRoute("stats.read", async (ctx) =>
  NextResponse.json(await meetingStats(ctx), { headers: { "Cache-Control": "no-store" } }),
);
