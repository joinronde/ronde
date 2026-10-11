import { eventsResponse } from "@/lib/server/meeting/responses";
import { type MeetingParams, meetingRoute } from "@/lib/server/meeting/route";

export const dynamic = "force-dynamic";

export const GET: (req: Request, params: MeetingParams) => Promise<Response> = meetingRoute("meeting.read", eventsResponse);
