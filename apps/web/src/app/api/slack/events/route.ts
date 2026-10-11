import { fromSlack, slackApp, slackUninstalled } from "@/lib/server/slack";

// Events of the Slack app: the address check when the app is set up, and its removal from a Slack workspace
export const dynamic = "force-dynamic";

interface SlackEvent {
  type?: string;
  challenge?: string;
  team_id?: string;
  event?: { type?: string; tokens?: { bot?: string[] } };
}

export async function POST(req: Request) {
  if (!slackApp()) return new Response(null, { status: 404 });
  const body = await req.text();
  if (!fromSlack(body, req.headers)) return new Response(null, { status: 401 });
  let e: SlackEvent;
  try {
    e = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (e.type === "url_verification") return Response.json({ challenge: e.challenge ?? "" });
  const gone = e.event?.type === "app_uninstalled" || (e.event?.type === "tokens_revoked" && !!e.event.tokens?.bot?.length);
  if (e.type === "event_callback" && gone && e.team_id) await slackUninstalled(e.team_id);
  return new Response(null, { status: 200 });
}
