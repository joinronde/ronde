import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { createFeedLink } from "@/lib/server/calendar";
import { errorResponse } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** New link to the personal feed: every meeting of the user (the previous link stops working) */
export async function POST() {
  try {
    const user = await requireUser();
    return NextResponse.json({ url: await createFeedLink(user.id, null) });
  } catch (e) {
    return errorResponse(e);
  }
}
