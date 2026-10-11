import { isLocale, resolveLocale } from "@ronde/i18n";
import { NextResponse } from "next/server";
import { AccessError } from "@/lib/server/errors";
import { decisionLog } from "@/lib/server/meeting/decisions";
import { moduleStates } from "@/lib/server/meeting/modules";
import { meetingRoute } from "@/lib/server/meeting/route";

export const dynamic = "force-dynamic";

// Decision log of the meeting (?q= to search, ?locale= for the places the decisions were taken)
export const GET = meetingRoute("history.read", async (ctx, req) => {
  if (!(await moduleStates(ctx.ws.db, ctx.meeting.id)).decisions?.enabled) throw new AccessError(403, "moduleDisabled");
  const params = new URL(req.url).searchParams;
  const asked = params.get("locale");
  const locale = isLocale(asked) ? asked : resolveLocale(ctx.meeting.locale, ctx.ws.workspace.locale);
  const items = await decisionLog(ctx.ws.db, ctx.meeting.id, locale, params.get("q") ?? "");
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
});
