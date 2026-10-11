import { fromSlack, openCheckIn, slackApp, submitCheckIn } from "@/lib/server/slack";

// Buttons and forms of the Slack app: "Fill in my check-in" opens the form, sending it saves the check-in.
// Slack wants an answer within 3 seconds.
export const dynamic = "force-dynamic";

interface Payload {
  type?: string;
  team?: { id?: string } | null;
  user?: { id?: string; team_id?: string };
  trigger_id?: string;
  actions?: { action_id?: string; value?: string }[];
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: { values?: Record<string, Record<string, { value?: string | null }>> };
  };
}

export async function POST(req: Request) {
  if (!slackApp()) return new Response(null, { status: 404 });
  const body = await req.text();
  if (!fromSlack(body, req.headers)) return new Response(null, { status: 401 });
  let p: Payload;
  try {
    p = JSON.parse(new URLSearchParams(body).get("payload") ?? "");
  } catch {
    return new Response(null, { status: 400 });
  }
  const teamId = p.team?.id ?? p.user?.team_id ?? "";
  const userId = p.user?.id ?? "";
  try {
    if (p.type === "block_actions") {
      const action = p.actions?.find((a) => a.action_id === "ronde.checkin");
      if (action?.value && p.trigger_id) await openCheckIn({ teamId, userId, triggerId: p.trigger_id, value: action.value });
    } else if (p.type === "view_submission" && p.view?.callback_id === "ronde.checkin")
      return Response.json(
        await submitCheckIn({ teamId, userId, metadata: p.view.private_metadata ?? "", values: p.view.state?.values ?? {} }),
      );
  } catch (e) {
    console.error("[slack] interaction", e);
  }
  return new Response(null, { status: 200 });
}
