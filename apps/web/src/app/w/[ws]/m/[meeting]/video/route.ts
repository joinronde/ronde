import { readConfig } from "@ronde/module-sdk";
import { video } from "@ronde/modules";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { pageUser } from "@/lib/server/authz";
import { meetingContext } from "@/lib/server/meeting/context";
import { moduleStates } from "@/lib/server/meeting/modules";
import { decryptSecret } from "@/lib/server/secrets";
import { bbbJoin } from "@/lib/server/video";

export const dynamic = "force-dynamic";

// Entry to the BigBlueButton room of a meeting: opens it and brings the person in with their name
export async function GET(_req: Request, { params }: { params: Promise<{ ws: string; meeting: string }> }) {
  const { ws, meeting } = await params;
  await pageUser(`/w/${ws}/m/${meeting}/video`);
  const ctx = await meetingContext(ws, meeting);
  if (!ctx) notFound();
  const mod = (await moduleStates(ctx.ws.db, ctx.meeting.id)).video;
  const config = readConfig(video, mod?.config);
  const secret = decryptSecret(mod?.secret ?? "");
  if (!mod?.enabled || config.provider !== "bbb" || !config.bbbUrl || !config.room || !secret) redirect(ctx.links.path);
  try {
    const url = await bbbJoin({
      server: config.bbbUrl,
      secret,
      room: config.room,
      name: ctx.meeting.name,
      person: ctx.viewer.name || ctx.viewer.email,
      moderator: ctx.viewer.isHost,
    });
    return NextResponse.redirect(url);
  } catch (e) {
    console.error("[video]", e);
    const t = await getTranslations("errors");
    return new NextResponse(t("videoUnreachable"), {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
