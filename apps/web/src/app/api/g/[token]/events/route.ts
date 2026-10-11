import { requireGuest } from "@/lib/server/guest-links";
import { errorResponse } from "@/lib/server/http";
import { eventsResponse } from "@/lib/server/meeting/responses";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    return await eventsResponse(await requireGuest((await params).token), req);
  } catch (e) {
    return errorResponse(e);
  }
}
