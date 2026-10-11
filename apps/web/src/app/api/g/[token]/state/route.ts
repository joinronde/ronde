import { requireGuest } from "@/lib/server/guest-links";
import { errorResponse } from "@/lib/server/http";
import { stateResponse } from "@/lib/server/meeting/responses";

// A guest link: the meeting's state, as the shared screen shows it
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    return await stateResponse(await requireGuest((await params).token));
  } catch (e) {
    return errorResponse(e);
  }
}
