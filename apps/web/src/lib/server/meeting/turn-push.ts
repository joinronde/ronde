import "server-only";
import type { Step } from "@ronde/core/meeting";
import { prisma, type Session } from "@ronde/db";
import { resolveLocale, translator } from "@ronde/i18n";
import { publicUrl } from "../public-url";
import { type PushMessage, sendPush } from "../push";
import type { MeetingCtx } from "./context";

// "Your turn" on the phone: when the session moves on, the person whose turn it now is, and the one after them
// (the people away left out), get a notification on the devices they turned them on for. Both carry the same
// tag: "it's your turn" takes the place of "you're next".

export async function pushTurns(m: Pick<MeetingCtx, "meeting" | "ws">, s: Session, agenda: Step[], step: Step): Promise<void> {
  const from = agenda.findIndex((x) => x.key === step.key);
  const speaking = step.type === "speaker" ? step.key : null;
  const next = agenda.slice(from).find((x) => x.type === "speaker" && x.key !== speaking && !s.absent.includes(x.key))?.key ?? null;
  const ids = [speaking, next].filter((x): x is string => !!x);
  if (!ids.length) return;
  const people = await prisma.person.findMany({
    where: { id: { in: ids }, workspaceId: m.meeting.workspaceId, userId: { not: null } },
    select: { id: true, userId: true, locale: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: people.map((p) => p.userId!) } },
    select: { id: true, locale: true },
  });
  const url = await publicUrl(`/w/${m.ws.workspace.slug}/m/${m.meeting.id}/me`);
  const messages: { userId: string; message: PushMessage }[] = [];
  for (const p of people) {
    const t = translator(
      resolveLocale(users.find((u) => u.id === p.userId)?.locale, p.locale, m.meeting.locale, m.ws.workspace.locale),
      "push",
    );
    const now = p.id === speaking;
    messages.push({
      userId: p.userId!,
      message: {
        title: t(now ? "turnNow" : "turnNext", { meeting: m.meeting.name }),
        body: now ? t("turnNowBody") : speaking ? t("turnNextBody", { current: step.label.split(" ")[0]! }) : t("turnNextSoon"),
        url,
        tag: `turn:${s.id}:${p.id}`,
      },
    });
  }
  // Only worth it while the session runs: gone after ten minutes
  await sendPush(messages, "turn", { ttl: 600, urgency: "high" });
}
