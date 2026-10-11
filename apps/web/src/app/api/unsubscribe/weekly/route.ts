import { setWeeklySummary, validUnsubscribe } from "@/lib/server/weekly";

// The mail client's "unsubscribe" button (RFC 8058): a POST with the signed link turns the weekly summary off at
// once. A visit in a browser goes to the page that asks first.

export async function POST(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("u") ?? "";
  if (!userId || !validUnsubscribe(userId, url.searchParams.get("t") ?? "")) return new Response(null, { status: 404 });
  await setWeeklySummary(userId, false);
  return new Response(null, { status: 204 });
}

export function GET(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/api\/unsubscribe\/weekly$/, "/unsubscribe/weekly");
  return Response.redirect(url, 303);
}
