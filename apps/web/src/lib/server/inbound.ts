import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { checkInReplyEmail } from "@ronde/core/notifications";
import { parseReply } from "@ronde/core/reply";
import { checkInFromItems, itemsFromCheckIn, resolveSections } from "@ronde/core/util";
import { prisma, scoped } from "@ronde/db";
import { resolveLocale } from "@ronde/i18n";
import EmailReplyParser from "email-reply-parser";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { emailBrand } from "./branding";
import { publish } from "./bus";
import { env } from "./env";
import { sendEmail } from "./mailer";
import { loadCheckIns, saveCheckIn } from "./meeting/checkins";
import { toSection } from "./meeting/dto";
import { publicUrl } from "./public-url";

// Check-ins written by email. A reminder carries a signed Message-ID naming the person and the meeting; the reply
// (whose In-Reply-To or References repeat it) is read from the mailbox of INBOUND_IMAP_URL every minute, its new
// lines go into that person's check-in, and an email says what was added. Only the replies to a reminder are
// touched: once read they move to a "Ronde" folder; every other message of the mailbox stays as it was.

/** Days a reminder can be answered */
const REPLY_DAYS = 14;
/** Biggest message read, and messages read per run */
const MAX_BYTES = 1_000_000;
const PER_RUN = 50;
/** Where the replies read are put away */
const DONE_FOLDER = "Ronde";

/** The address replies are sent to: INBOUND_ADDRESS, otherwise the IMAP account when it is an email address */
export function inboundAddress(): string | null {
  const own = env.inboundAddress().trim();
  if (own) return own;
  try {
    const user = decodeURIComponent(new URL(env.inboundImapUrl()).username);
    return user.includes("@") ? user : null;
  } catch {
    return null;
  }
}

/** Whether replies to reminders are read */
export const inboundOn = () => !!env.inboundImapUrl() && !!inboundAddress();

const hex = (uuid: string) => uuid.replace(/-/g, "");
const uuid = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
const sign = (payload: string) => createHmac("sha256", env.authSecret()).update(`inbound:${payload}`).digest("base64url").slice(0, 22);
const day = (at: number) => Math.floor(at / 86_400_000);

/** The Message-ID of a reminder to this person for this meeting; null when replies are not read */
export function replyMessageId(personId: string, meetingId: string, now = Date.now()): string | null {
  const address = inboundAddress();
  if (!address || !inboundOn()) return null;
  const payload = `${hex(personId)}.${hex(meetingId)}.${(day(now) + REPLY_DAYS).toString(36)}`;
  return `<ck.${payload}.${sign(payload)}@${address.split("@").pop()}>`;
}

const ID = /ck\.([0-9a-f]{32})\.([0-9a-f]{32})\.([0-9a-z]{1,8})\.([\w-]{22})@/g;

/** The person and meeting a reply answers (its In-Reply-To and References), when genuine and still open */
export function replyTarget(headers: (string | undefined)[], now = Date.now()): { personId: string; meetingId: string } | null {
  for (const header of headers)
    for (const m of (header ?? "").matchAll(ID)) {
      const payload = `${m[1]}.${m[2]}.${m[3]}`;
      const given = Buffer.from(m[4]!);
      const expected = Buffer.from(sign(payload));
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) continue;
      if (Number.parseInt(m[3]!, 36) < day(now)) continue;
      return { personId: uuid(m[1]!), meetingId: uuid(m[2]!) };
    }
  return null;
}

export type ReplyResult = "added" | "already" | "nothing" | "refused";

/**
 * A reply read: its new lines go into the person's check-in for the meeting (nothing is removed), and they get an
 * email saying what was added. Refused, silently, when the sender is not that person or the meeting is not theirs.
 */
export async function applyReply(p: { personId: string; meetingId: string; from: string; text: string }): Promise<ReplyResult> {
  const person = await prisma.person.findFirst({
    where: { id: p.personId, active: true, deprovisionedAt: null, sample: false, workspace: { deletedAt: null, suspendedAt: null } },
    select: { id: true, workspaceId: true, email: true, firstName: true, lastName: true, locale: true, userId: true },
  });
  if (!person) return "refused";
  // From the address the reminder went to, or the one of their account
  const account = person.userId ? await prisma.user.findUnique({ where: { id: person.userId }, select: { email: true } }) : null;
  const from = p.from.trim().toLowerCase();
  if (![person.email, account?.email].some((e) => e?.toLowerCase() === from)) return "refused";
  const db = scoped(prisma, person.workspaceId);
  const meeting = await db.meeting.findFirst({
    where: { id: p.meetingId, archivedAt: null, sample: false },
    select: { id: true, name: true, locale: true, workspace: { select: { slug: true, locale: true } } },
  });
  const seat = meeting
    ? await db.meetingParticipant.findFirst({
        where: { meetingId: meeting.id, personId: person.id, active: true, role: { not: "observer" } },
      })
    : null;
  if (!meeting || !seat) return "refused";

  const rows = (await db.section.findMany({ where: { meetingId: meeting.id }, orderBy: { position: "asc" } })).map(toSection);
  const locale = resolveLocale(person.locale, meeting.locale, meeting.workspace.locale);
  const labels = resolveSections({ sections: rows }, locale);
  const parsed = parseReply(
    p.text,
    rows.map((r, i) => ({ key: r.key, label: labels[i]?.label ?? r.key, input: r.input })),
  );
  const found = Object.values(parsed).some((items) => items.length);
  const added: Record<string, string[]> = {};
  if (found)
    await db.$transaction(async (tx) => {
      // Same turn-taking as the page and Slack: saves of one check-in wait for each other
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`checkin:${meeting.id}:${person.id}`}, 0))`;
      const mine = (await loadCheckIns(tx, meeting.id, rows))[person.id];
      const items = mine ? itemsFromCheckIn(mine, rows) : {};
      for (const r of rows) {
        const had = items[r.key] ?? [];
        const fresh = (parsed[r.key] ?? []).filter((i) => !had.includes(i));
        if (!fresh.length) continue;
        added[r.key] = fresh;
        // A free-text section gets the new paragraph after its own
        items[r.key] = r.input === "text" ? [[...had, ...fresh].join("\n\n")] : [...had, ...fresh];
      }
      if (Object.keys(added).length)
        await saveCheckIn(
          tx,
          { workspaceId: person.workspaceId, meetingId: meeting.id, personId: person.id },
          checkInFromItems(items, rows),
          rows,
        );
    });
  if (Object.keys(added).length) await publish(meeting.id, { kind: "state" });

  const message = checkInReplyEmail({
    locale,
    name: [person.firstName, person.lastName].filter(Boolean).join(" "),
    teamName: meeting.name,
    added: rows.flatMap((r, i) => (added[r.key] ? [{ label: labels[i]?.label ?? r.key, items: added[r.key]! }] : [])),
    already: found,
    url: await publicUrl(`/w/${meeting.workspace.slug}/m/${meeting.id}/me`),
    brand: await emailBrand(person.workspaceId),
  });
  await sendEmail({ to: person.email, ...message });
  return Object.keys(added).length ? "added" : found ? "already" : "nothing";
}

/** The visible text of a reply: the quoted reminder and the signature left out */
export function replyText(text: string): string {
  return new EmailReplyParser().read(text).getVisibleText().trim();
}

function imapClient(url: string): { client: ImapFlow; mailbox: string } {
  const u = new URL(url);
  const secure = u.protocol === "imaps:";
  return {
    client: new ImapFlow({
      host: u.hostname,
      port: Number(u.port) || (secure ? 993 : 143),
      secure,
      auth: { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) },
      logger: false,
    }),
    mailbox: decodeURIComponent(u.pathname.replace(/^\//, "")) || "INBOX",
  };
}

/** Reads the replies waiting in the mailbox (every minute); returns how many were taken into check-ins */
export async function checkInbound(now = new Date()): Promise<number> {
  const url = env.inboundImapUrl();
  if (!url || !inboundAddress()) return 0;
  const { client, mailbox } = imapClient(url);
  await client.connect();
  let read = 0;
  try {
    await client.mailboxCreate(DONE_FOLDER).catch(() => undefined);
    const lock = await client.getMailboxLock(mailbox);
    try {
      const since = new Date(now.getTime() - (REPLY_DAYS + 1) * 86_400_000);
      const uids = ((await client.search({ seen: false, since }, { uid: true })) || []).slice(-PER_RUN * 4);
      for (const uid of uids) {
        if (read >= PER_RUN) break;
        // The headers first: only a reply to a reminder is downloaded and touched
        const head = await client.fetchOne(String(uid), { envelope: true, size: true, headers: ["references"] }, { uid: true });
        if (!head) continue;
        const references = head.headers?.toString("utf8") ?? "";
        const target = replyTarget([head.envelope?.inReplyTo, references], now.getTime());
        if (!target) continue;
        if ((head.size ?? 0) <= MAX_BYTES) {
          const full = await client.fetchOne(String(uid), { source: true }, { uid: true });
          const mail = full && full.source ? await simpleParser(full.source) : null;
          const from = mail?.from?.value[0]?.address ?? "";
          if (mail && from) {
            try {
              await applyReply({ ...target, from, text: replyText(mail.text ?? "") });
              read++;
            } catch (e) {
              console.error("[inbound] reply not applied", e);
              continue;
            }
          }
        }
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        await client.messageMove(String(uid), DONE_FOLDER, { uid: true }).catch(() => undefined);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  if (read) console.log(`[inbound] ${read} check-in${read > 1 ? "s" : ""} written by email`);
  return read;
}
