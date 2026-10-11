import { type Activity, fromTeams, handleActivity, teamsApp } from "@/lib/server/teams";

// The Teams app's messaging endpoint: every activity of the bot (added to a team, a message, a button of its
// cards) arrives here, signed by Microsoft. Teams wants an answer within a few seconds.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!teamsApp()) return new Response(null, { status: 404 });
  let activity: Activity;
  try {
    activity = (await req.json()) as Activity;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!(await fromTeams(req.headers.get("authorization") ?? "", activity))) return new Response(null, { status: 401 });
  try {
    const answer = await handleActivity(activity);
    return answer ? Response.json(answer) : new Response(null, { status: 200 });
  } catch (e) {
    console.error("[teams] activity", e);
    // An invoke still needs an answer: Teams then says the action failed
    return activity.type === "invoke"
      ? Response.json({ statusCode: 500, type: "application/vnd.microsoft.error", value: { code: "Error" } })
      : new Response(null, { status: 200 });
  }
}
