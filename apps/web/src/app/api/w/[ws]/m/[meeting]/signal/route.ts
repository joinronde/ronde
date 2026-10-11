import { signalResponse } from "@/lib/server/meeting/responses";
import { meetingRoute } from "@/lib/server/meeting/route";

export const dynamic = "force-dynamic";

export const POST = meetingRoute("meeting.read", signalResponse);
