import { feedDocument } from "@/lib/server/calendar";

export const dynamic = "force-dynamic";

// Calendar feed read by calendar apps (no session: the secret link is the credential)
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/, "");
  const ics = /^[\w-]{20,64}$/.test(token) ? await feedDocument(token) : null;
  if (!ics) return new Response("Not found", { status: 404 });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="ronde.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
