import { NextResponse } from "next/server";
import { createFeedLink } from "@/lib/server/calendar";
import { meetingRoute } from "@/lib/server/meeting/route";

export const dynamic = "force-dynamic";

/** New link to the feed of this meeting, for the signed-in user (the previous link stops working) */
export const POST = meetingRoute("meeting.read", async (ctx) =>
  NextResponse.json({ url: await createFeedLink(ctx.viewer.userId, ctx.meeting.id) }),
);
