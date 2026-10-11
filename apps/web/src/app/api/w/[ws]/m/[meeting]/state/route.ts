import { stateResponse } from "@/lib/server/meeting/responses";
import { meetingRoute } from "@/lib/server/meeting/route";

export const dynamic = "force-dynamic";

export const GET = meetingRoute("meeting.read", (ctx) => stateResponse(ctx));
