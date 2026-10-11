import { NextResponse } from "next/server";
import { runOp } from "@/lib/server/meeting/ops";
import { meetingRoute } from "@/lib/server/meeting/route";

export const dynamic = "force-dynamic";

// Every change of a meeting goes through here: the operation checks its own permission
export const POST = meetingRoute("meeting.read", async (ctx, req) => {
  await runOp(ctx, await req.json());
  return NextResponse.json({ ok: true });
});
