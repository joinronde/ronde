import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { publish, subscribe } from "../bus";
import { AccessError, OpError } from "../errors";
import { requestLocale } from "../locale";
import type { MeetingCtx } from "./context";
import { loadSnapshot } from "./state";

// What a meeting's API answers, for a member (/api/w/…/m/…) as for a guest link (/api/g/…): the state,
// the event stream, the screen sharing signals

export async function stateResponse(ctx: MeetingCtx, rewrite?: (snapshot: Awaited<ReturnType<typeof loadSnapshot>>) => void) {
  const snapshot = await loadSnapshot(ctx, await requestLocale());
  rewrite?.(snapshot);
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}

/** Event stream of a meeting (Server-Sent Events): the browser is told about every change */
export async function eventsResponse(ctx: MeetingCtx, req: Request): Promise<Response> {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };
      // Screen sharing signals go to their tab only (announcements to every tab, never back to the sender)
      const client = new URL(req.url).searchParams.get("client") ?? "";
      const unsubscribe = await subscribe(ctx.meeting.id, (ev) => {
        if (ev.kind === "signal" && ((ev.to !== "*" && ev.to !== client) || ev.from === client)) return;
        send(`event: ${ev.kind}\ndata: ${JSON.stringify(ev)}\n\n`);
      });
      // Regular ping: keeps the connection open through proxies, and lets the browser detect a stuck
      // stream (a proxy keeping the connection without forwarding anything)
      const ping = setInterval(() => send(`event: ping\ndata: {}\n\n`), 15_000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
      };
      send(`retry: 3000\nevent: ready\ndata: {}\n\n`);
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// Screen sharing to the room (WebRTC between two tabs, no media server): the tabs exchange their offers,
// answers and network candidates through the meeting's event stream. Only hosts share; announcements
// carry no network details.
const body = z.object({
  to: z.string().min(1).max(40),
  from: z.string().min(8).max(40),
  type: z.enum(["share", "stop", "hello", "offer", "answer", "ice"]),
  data: z.unknown(),
});
/** PostgreSQL notifications carry at most 8000 bytes */
const MAX_DATA = 6000;

export async function signalResponse(ctx: MeetingCtx, req: Request): Promise<Response> {
  const s = body.safeParse(await req.json().catch(() => null));
  if (!s.success) throw new OpError("invalidRequest");
  const { to, from, type, data } = s.data;
  if ((type === "share" || type === "stop" || type === "offer") && !ctx.can("session.run")) throw new AccessError(403, "hostOnly");
  // Broadcasts are announcements, never network details
  if (to === "*" && !["share", "stop", "hello"].includes(type)) throw new OpError("invalidRequest");
  if (JSON.stringify(data ?? null).length > MAX_DATA) throw new OpError("invalidRequest");
  await publish(ctx.meeting.id, { kind: "signal", to, from, type, data: data ?? null });
  return NextResponse.json({ ok: true });
}
