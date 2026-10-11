import "server-only";
import { prisma } from "@ronde/db";
import { type Locale, resolveLocale, translator } from "@ronde/i18n";
import webpush from "web-push";
import { env } from "./env";
import { publicUrl } from "./public-url";

// Push notifications (Web Push) on the devices people turn them on for, from their account: when their turn
// is coming up, the check-in reminder, and what lands in the bell. Each kind can be turned off; a device the
// push service no longer knows is forgotten.

export const PUSH_KINDS = ["turn", "reminder", "inbox"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
const offKey = (kind: PushKind) => `push:off:${kind}`;

/** Whether the instance has its keys */
export const pushOn = () => !!env.webPushPublicKey() && !!env.webPushPrivateKey();

let ready = "";
function setup() {
  const keys = `${env.webPushPublicKey()}:${env.webPushPrivateKey()}`;
  if (ready === keys) return;
  webpush.setVapidDetails(env.webPushSubject(), env.webPushPublicKey(), env.webPushPrivateKey());
  ready = keys;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Absolute address opened by a tap */
  url: string;
  /** A newer notification with the same tag replaces the older one on the device */
  tag?: string;
}

/**
 * Sends each message to the devices of its person, unless they turned this kind off. Returns the number of
 * devices reached. Never throws: a notification is a courtesy, not something to fail an action for.
 */
export async function sendPush(
  messages: { userId: string; message: PushMessage }[],
  kind: PushKind,
  options: { ttl?: number; urgency?: "high" | "normal" } = {},
): Promise<number> {
  if (!pushOn() || !messages.length) return 0;
  try {
    setup();
    const ids = [...new Set(messages.map((m) => m.userId))];
    const [devices, off] = await Promise.all([
      prisma.pushSubscription.findMany({ where: { userId: { in: ids } } }),
      prisma.userPref.findMany({ where: { userId: { in: ids }, key: offKey(kind) }, select: { userId: true } }),
    ]);
    const muted = new Set(off.map((o) => o.userId));
    let reached = 0;
    await Promise.all(
      messages
        .filter((m) => !muted.has(m.userId))
        .flatMap(({ userId, message }) =>
          devices
            .filter((d) => d.userId === userId)
            .map(async (d) => {
              try {
                await webpush.sendNotification(
                  { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
                  JSON.stringify(message),
                  {
                    TTL: options.ttl ?? 6 * 3600,
                    urgency: options.urgency ?? "normal",
                  },
                );
                reached++;
                await prisma.pushSubscription.update({ where: { id: d.id }, data: { lastSentAt: new Date() } });
              } catch (e) {
                const status = (e as { statusCode?: number }).statusCode;
                // Unsubscribed, or expired: the device is forgotten
                if (status === 404 || status === 410) await prisma.pushSubscription.deleteMany({ where: { id: d.id } });
                else console.error(`[push] not sent (${status ?? "network"})`);
              }
            }),
        ),
    );
    return reached;
  } catch (e) {
    console.error("[push] failed", e);
    return 0;
  }
}

/** A device turned on for this person (the same browser signed in as someone else moves to them) */
export async function savePushDevice(
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  label: string,
): Promise<void> {
  const url = new URL(sub.endpoint);
  const key = /^[\w-]{20,200}$/;
  if (url.protocol !== "https:" || sub.endpoint.length > 1000 || !key.test(sub.keys.p256dh) || !key.test(sub.keys.auth))
    throw new Error("invalid subscription");
  const data = { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, label: label.slice(0, 80) };
  await prisma.pushSubscription.upsert({ where: { endpoint: sub.endpoint }, create: { endpoint: sub.endpoint, ...data }, update: data });
}

export async function removePushDevice(userId: string, id: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { id, userId } });
}

export async function pushDevices(userId: string) {
  return prisma.pushSubscription.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, endpoint: true, label: true, createdAt: true, lastSentAt: true },
  });
}

/** Which kinds the person gets (all unless turned off) */
export async function pushKinds(userId: string): Promise<Record<PushKind, boolean>> {
  const off = await prisma.userPref.findMany({ where: { userId, key: { in: PUSH_KINDS.map(offKey) } }, select: { key: true } });
  return Object.fromEntries(PUSH_KINDS.map((k) => [k, !off.some((o) => o.key === offKey(k))])) as Record<PushKind, boolean>;
}

export async function setPushKind(userId: string, kind: PushKind, on: boolean): Promise<void> {
  if (on) await prisma.userPref.deleteMany({ where: { userId, key: offKey(kind) } });
  else
    await prisma.userPref.upsert({
      where: { userId_key: { userId, key: offKey(kind) } },
      create: { userId, key: offKey(kind), value: true },
      update: { value: true },
    });
}

/** A test, to see that this person's devices get the notifications */
export async function testPush(userId: string, locale: Locale): Promise<number> {
  const t = translator(locale, "push");
  return sendPush(
    [{ userId, message: { title: t("test"), body: t("testBody"), url: await publicUrl("/account/notifications"), tag: "test" } }],
    "inbox",
    {
      ttl: 600,
    },
  );
}

/** Bell items are pushed for this long after they appear; older ones are not worth a notification any more */
const INBOX_FRESH_MS = 10 * 60_000;

/** The bell's new items, on the devices of the people they are for (every minute) */
export async function pushInbox(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - INBOX_FRESH_MS);
  // Too old to be news, or pushes are off: marked done so they are not looked at again
  await prisma.inboxItem.updateMany({
    where: { pushedAt: null, ...(pushOn() ? { createdAt: { lt: since } } : {}) },
    data: { pushedAt: now },
  });
  if (!pushOn()) return 0;
  const items = await prisma.inboxItem.findMany({ where: { pushedAt: null }, orderBy: { createdAt: "asc" }, take: 200 });
  if (!items.length) return 0;
  const [people, meetings, workspaces] = await Promise.all([
    prisma.person.findMany({
      where: { id: { in: [...new Set(items.flatMap((i) => [i.personId, ...(i.actorId ? [i.actorId] : [])]))] } },
      select: { id: true, userId: true, firstName: true, lastName: true, email: true, locale: true },
    }),
    prisma.meeting.findMany({
      where: { id: { in: [...new Set(items.flatMap((i) => (i.meetingId ? [i.meetingId] : [])))] } },
      select: { id: true, name: true },
    }),
    prisma.workspace.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.workspaceId))] } },
      select: { id: true, slug: true, name: true, locale: true },
    }),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: people.flatMap((p) => (p.userId ? [p.userId] : [])) } },
    select: { id: true, locale: true },
  });
  const name = (id: string | null) => {
    const p = people.find((x) => x.id === id);
    return p ? [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email : null;
  };
  const messages: { userId: string; message: PushMessage }[] = [];
  for (const item of items) {
    const person = people.find((p) => p.id === item.personId);
    const ws = workspaces.find((w) => w.id === item.workspaceId);
    if (!person?.userId || !ws) continue;
    const locale = resolveLocale(users.find((u) => u.id === person.userId)?.locale, person.locale, ws.locale);
    const t = translator(locale, "inbox");
    const meeting = meetings.find((m) => m.id === item.meetingId)?.name ?? "";
    const key = `kinds.${item.kind.replace(".", "_")}` as Parameters<typeof t.markup>[0];
    const text = (item.data as { text?: string } | null)?.text;
    messages.push({
      userId: person.userId,
      message: {
        title: meeting || ws.name,
        body: [t.markup(key, { actor: name(item.actorId) ?? t("someone"), meeting, strong: (chunks) => chunks }), text]
          .filter(Boolean)
          .join("\n"),
        url: await publicUrl(`/w/${ws.slug}${item.href}`),
        tag: `inbox:${item.id}`,
      },
    });
  }
  await prisma.inboxItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { pushedAt: now } });
  return sendPush(messages, "inbox");
}
