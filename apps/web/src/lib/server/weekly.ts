import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { REMINDER_LOGO_CID, weeklyEmail } from "@ronde/core/notifications";
import { prisma } from "@ronde/db";
import { isLocale, type Locale } from "@ronde/i18n";
import nodemailer, { type Transporter } from "nodemailer";
import { memberContext } from "./authz";
import { emailBrand } from "./branding";
import { calendarEvents } from "./calendar-view";
import { env } from "./env";
import { personName } from "./meeting/dto";
import { listActions } from "./my-actions";
import { publicUrl } from "./public-url";
import { zonedClock } from "./reminders";

// The weekly summary: on Monday morning, each member gets their week in a workspace (their sessions, their open
// actions, the kudos they received), only when there is something in it. A person turns it off in their account
// or with the link of the email (one click, signed, no sign-in needed).

/** Turned off by the person */
export const WEEKLY_OFF = "weekly:off";
/** The week (ISO, "2026-W42") last sent for a workspace */
const sentKey = (workspaceId: string) => `weekly:sent:${workspaceId}`;
/** Emails sent at most per run (hourly): an OVH mailbox takes about 200 an hour; the rest goes the next hour */
const PER_RUN = () => Number(process.env.RONDE_WEEKLY_PER_RUN) || 150;

/** ISO week of a local date, "2026-W42" */
export function isoWeek(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Monday and Sunday of the week of a local date */
function weekBounds(date: string): { monday: string; sunday: string; weekday: number } {
  const d = new Date(`${date}T12:00:00Z`);
  const weekday = ((d.getUTCDay() + 6) % 7) + 1;
  const shift = (n: number) => new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  return { monday: shift(1 - weekday), sunday: shift(7 - weekday), weekday };
}

const mac = (userId: string) => createHmac("sha256", env.authSecret()).update(`weekly-off:${userId}`).digest("base64url");

/** The way out of the summary, for this person: a page that asks before turning it off */
export function unsubscribeLink(userId: string): Promise<string> {
  return publicUrl(`/unsubscribe/weekly?u=${encodeURIComponent(userId)}&t=${mac(userId)}`);
}

/** The same, for the mail client's own "unsubscribe" button: a POST turns it off at once (RFC 8058) */
export function unsubscribeOneClick(userId: string): Promise<string> {
  return publicUrl(`/api/unsubscribe/weekly?u=${encodeURIComponent(userId)}&t=${mac(userId)}`);
}

/** Whether a way-out link is genuine */
export function validUnsubscribe(userId: string, token: string): boolean {
  const expected = mac(userId);
  // Compared as bytes: a character beyond ASCII must not make two lengths differ there and throw
  const [a, b] = [Buffer.from(token), Buffer.from(expected)];
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function setWeeklySummary(userId: string, on: boolean): Promise<void> {
  if (on) await prisma.userPref.deleteMany({ where: { userId, key: WEEKLY_OFF } });
  else
    await prisma.userPref.upsert({
      where: { userId_key: { userId, key: WEEKLY_OFF } },
      create: { userId, key: WEEKLY_OFF, value: true },
      update: { value: true },
    });
}

/**
 * Checked every hour: from Monday 08:00 in each workspace's time zone (and until Wednesday, for the ones the
 * hourly allowance left out), the summaries not sent yet this week. Returns the number sent.
 */
export async function sendWeeklySummaries(now = new Date(), transport?: Transporter): Promise<number> {
  if (!transport && !env.smtpUrl()) return 0;
  const mailer = transport ?? nodemailer.createTransport(env.smtpUrl());
  const workspaces = await prisma.workspace.findMany({
    where: { deletedAt: null, suspendedAt: null },
    select: { id: true, slug: true, name: true, locale: true, timezone: true },
  });
  let sent = 0;
  for (const ws of workspaces) {
    const clock = zonedClock(now, ws.timezone || "UTC");
    const { monday, sunday, weekday } = weekBounds(clock.date);
    if (!((weekday === 1 && clock.minutes >= 8 * 60) || weekday === 2 || weekday === 3)) continue;
    const week = isoWeek(clock.date);
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: ws.id, status: "active" },
      select: {
        userId: true,
        personId: true,
        user: { select: { email: true, name: true, locale: true, prefs: { where: { key: { in: [WEEKLY_OFF, sentKey(ws.id)] } } } } },
      },
    });
    const brand = await emailBrand(ws.id);
    // The sample meeting's sessions and actions are make-believe: not in anyone's week
    const samples = new Set(
      (await prisma.meeting.findMany({ where: { workspaceId: ws.id, sample: true }, select: { id: true } })).map((s) => s.id),
    );
    const [home, settingsUrl, meetingUrl] = await Promise.all([
      publicUrl(`/w/${ws.slug}`),
      publicUrl("/account/notifications"),
      publicUrl(`/w/${ws.slug}/m/`),
    ]);
    for (const m of members) {
      if (sent >= PER_RUN()) return sent;
      const prefs = m.user.prefs;
      if (prefs.some((p) => p.key === WEEKLY_OFF) || prefs.some((p) => p.key === sentKey(ws.id) && p.value === week)) continue;
      const markSent = () =>
        prisma.userPref.upsert({
          where: { userId_key: { userId: m.userId, key: sentKey(ws.id) } },
          create: { userId: m.userId, key: sentKey(ws.id), value: week },
          update: { value: week },
        });
      try {
        const ctx = await memberContext(ws.id, m.userId);
        if (!ctx) continue;
        const [events, actions, kudos] = await Promise.all([
          calendarEvents(ctx, monday, sunday),
          listActions(ctx, "mine"),
          ctx.db.kudo.findMany({
            where: { toId: m.personId, createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
            orderBy: { createdAt: "asc" },
            select: { text: true, fromId: true },
          }),
        ]);
        const givers = await ctx.db.person.findMany({
          where: { id: { in: [...new Set(kudos.map((k) => k.fromId))] } },
          select: { id: true, firstName: true, lastName: true, email: true },
        });
        // Their own sessions (not the ones an administrator only sees), still ahead this week
        const sessions = events
          .filter(
            (e) =>
              !samples.has(e.meetingId) &&
              e.role !== null &&
              e.role !== "observer" &&
              (e.status === "planned" || e.status === "live") &&
              e.date >= clock.date,
          )
          .map((e) => ({
            date: e.date,
            time: e.time,
            meeting: e.meeting,
            url: `${meetingUrl}${e.meetingId}/me`,
          }));
        const open = actions
          .filter((a) => a.status !== "done" && !samples.has(a.meetingId))
          .map((a) => ({ text: a.text, meeting: a.meeting, status: a.status, carried: a.carried }));
        const thanks = kudos.flatMap((k) => {
          const giver = givers.find((g) => g.id === k.fromId);
          return giver ? [{ from: personName(giver), text: k.text }] : [];
        });
        if (!sessions.length && !open.length && !thanks.length) {
          await markSent();
          continue;
        }
        const locale: Locale = isLocale(m.user.locale) ? m.user.locale : isLocale(ws.locale) ? ws.locale : "en";
        const [out, oneClick] = await Promise.all([unsubscribeLink(m.userId), unsubscribeOneClick(m.userId)]);
        const message = weeklyEmail({
          locale,
          name: m.user.name || m.user.email,
          workspace: ws.name,
          sessions,
          actions: open,
          kudos: thanks,
          url: home,
          settingsUrl,
          unsubscribeUrl: out,
          brand,
        });
        await mailer.sendMail({
          from: env.mailFrom(),
          to: m.user.email,
          ...message,
          // One click from the mail client's own "unsubscribe" (RFC 8058)
          headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          attachments: brand
            ? []
            : [
                {
                  filename: "ronde.png",
                  path: path.join(process.cwd(), "public", "icon.png"),
                  cid: REMINDER_LOGO_CID,
                  contentType: "image/png",
                  contentDisposition: "inline",
                },
              ],
        });
        await markSent();
        sent++;
      } catch (e) {
        console.error(`[weekly] summary of ${m.userId} in ${ws.slug} failed`, e);
      }
    }
  }
  if (sent) console.log(`[weekly] ${sent} weekly summar${sent > 1 ? "ies" : "y"} sent`);
  return sent;
}
