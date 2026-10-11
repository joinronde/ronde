import { translator } from "@ronde/i18n";
import { env } from "@/lib/server/env";
import { commandReply, fromSlack, slackApp } from "@/lib/server/slack";

// "/ronde" in Slack: the person's next sessions and open follow-up actions, shown to them only
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!slackApp()) return new Response(null, { status: 404 });
  const body = await req.text();
  if (!fromSlack(body, req.headers)) return new Response(null, { status: 401 });
  const q = new URLSearchParams(body);
  try {
    return Response.json(await commandReply(q.get("team_id") ?? "", q.get("user_id") ?? ""));
  } catch (e) {
    console.error("[slack] command", e);
    return Response.json({ response_type: "ephemeral", text: translator(env.defaultLocale(), "slack")("unavailable") });
  }
}
