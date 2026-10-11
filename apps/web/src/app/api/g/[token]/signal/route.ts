import { requireGuest } from "@/lib/server/guest-links";
import { errorResponse } from "@/lib/server/http";
import { signalResponse } from "@/lib/server/meeting/responses";

// A guest's screen receives the host's shared screen like the room's (it only answers, never shares)
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    return await signalResponse(await requireGuest((await params).token), req);
  } catch (e) {
    return errorResponse(e);
  }
}
