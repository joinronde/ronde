import "server-only";
import type { Permission } from "@ronde/core/permissions";
import { errorResponse } from "../http";
import { type MeetingCtx, requireMeeting } from "./context";

export type MeetingParams = { params: Promise<{ ws: string; meeting: string }> };

/** API route of a meeting: resolves the meeting and the viewer, checks a permission, turns errors into JSON */
export const meetingRoute =
  (permission: Permission, handler: (ctx: MeetingCtx, req: Request) => Promise<Response>) =>
  async (req: Request, { params }: MeetingParams): Promise<Response> => {
    try {
      const { ws, meeting } = await params;
      return await handler(await requireMeeting(ws, meeting, permission), req);
    } catch (e) {
      return errorResponse(e);
    }
  };
