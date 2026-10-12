import "server-only";
import { DRIVERS, isPhoneKind, type Outgoing } from "@ronde/connectors";
import { decisionsOf } from "@ronde/core/minutes";
import { type NotifyEvent, type NotifyInput, notifyMessage, type RichMessage, safeUrl } from "@ronde/core/notify";
import { localDate } from "@ronde/core/schedule";
import type { MeetingRecord } from "@ronde/core/types";
import { isCheckInReady } from "@ronde/core/util";
import { workflowFacts, workflowVariables } from "@ronde/core/workflows";
import { Prisma, prisma, scoped } from "@ronde/db";
import { currentJobs } from "@ronde/jobs";
import { enterprise } from "@/ee-bridge";
import { awayPeople } from "../absences";
import { AppError } from "../errors";
import { featureOn, loadLicense } from "../license";
import { sendEmail } from "../mailer";
import { loadCheckIns } from "../meeting/checkins";
import { personName } from "../meeting/dto";
import { type NotifiedMeeting, notifiedMeeting } from "../notified-meeting";
import { outboundFetch } from "../outbound";
import { decryptSecret } from "../secrets";

// Notifications: an event of a meeting becomes one delivery per matching rule. Each delivery has a unique
// key, so an event goes out once per rule even if it is raised twice (two replicas, a retry, a reload).

/** Event names in the database use underscores (session_soon), in the app dots (session.soon) */
export const dbEvent = (e: NotifyEvent) => e.replace(".", "_") as Prisma.NotificationRuleCreateInput["event"];
export const appEvent = (e: string) => e.replace("_", ".") as NotifyEvent;

/** Data of an event, stored with the delivery: retries send the same message */
export type NotifyPayload = Pick<NotifyInput, "session" | "minutesBefore" | "minutes" | "overdue" | "names"> & { progress?: true };

export interface NotifyOptions {
  /** Keeps only the rules whose options match (minutes before, days…) */
  filter?: (options: Record<string, unknown>) => boolean;
  /** Sends right away and throws on failure (a nudge asked by the host), instead of queueing */
  inline?: boolean;
}

/**
 * Raises an event of a meeting: one delivery per enabled rule, each sent at most once for `scopeKey`
 * (a session and its date, a day…). Returns the number of deliveries created.
 */
export async function notifyEvent(
  meetingId: string,
  event: NotifyEvent,
  scopeKey: string,
  payload: NotifyPayload,
  { filter = () => true, inline = false }: NotifyOptions = {},
): Promise<number> {
  const rules = await prisma.notificationRule.findMany({ where: { meetingId, event: dbEvent(event), enabled: true } });
  let queued = 0;
  for (const rule of rules) {
    if (!filter((rule.options ?? {}) as Record<string, unknown>)) continue;
    try {
      const d = await prisma.delivery.create({
        data: {
          workspaceId: rule.workspaceId,
          connectorId: rule.connectorId,
          ruleId: rule.id,
          meetingId,
          event,
          key: `${rule.id}:${event}:${scopeKey}`,
          payload: payload as Prisma.InputJsonObject,
        },
      });
      if (inline) {
        await deliver(d.id);
        // Sent right away: one skipped (its conditions, or a plan without it) does not count as sent
        if ((await prisma.delivery.findUnique({ where: { id: d.id }, select: { status: true } }))?.status !== "skipped") queued++;
      } else {
        queued++;
        await dispatch(d.id);
      }
    } catch (e) {
      // Already raised for this rule and scope: nothing more to send
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  return queued;
}

/** Hands a delivery to the job queue (retries); without a queue running, sends it right away */
async function dispatch(deliveryId: string) {
  const jobs = currentJobs();
  if (jobs) await (await jobs).send("notify.deliver", { deliveryId }, { singletonKey: deliveryId });
  else await deliver(deliveryId).catch((e) => console.error(`[notify] delivery ${deliveryId} failed`, e));
}

/**
 * Email addresses (or mobile numbers) of a rule's audience: the participants who get reminders, or the hosts.
 * People away today are left out.
 */
async function audience(meetingId: string, who: unknown, channel: "email" | "phone" = "email"): Promise<string[]> {
  const rows = await prisma.meetingParticipant.findMany({
    where: { meetingId, ...(who === "hosts" ? { role: { in: ["host", "cohost"] } } : { role: { not: "observer" }, remind: true }) },
    select: {
      personId: true,
      person: { select: { email: true, phone: true, active: true } },
      meeting: { select: { workspaceId: true, timezone: true, workspace: { select: { timezone: true } } } },
    },
  });
  const first = rows[0]?.meeting;
  const db = first ? scoped(prisma, first.workspaceId) : null;
  // Absent from the session being prepared (said no, marked by the host): not reminded of it either
  const session = db ? await db.session.findFirst({ where: { meetingId, status: "current" }, select: { absent: true, date: true } }) : null;
  // Away on the session's day (the evening before, tomorrow's leave counts), today without one
  const away = first
    ? await awayPeople(
        db!,
        session?.date ?? localDate(Date.now(), first.timezone ?? first.workspace.timezone),
        rows.map((r) => r.personId),
      )
    : [];
  return rows
    .filter((r) => r.person.active && !away.includes(r.personId) && !session?.absent.includes(r.personId))
    .flatMap((r) => (channel === "phone" ? (r.person.phone ? [r.person.phone] : []) : [r.person.email]));
}

/** Check-ins ready for the current session, counted when the message is sent */
async function progress(n: NotifiedMeeting) {
  const meetingId = n.meeting.id;
  const db = scoped(prisma, n.meeting.workspaceId);
  const [participants, checkIns, last, session] = await Promise.all([
    db.meetingParticipant.findMany({ where: { meetingId, active: true, role: { not: "observer" } }, select: { personId: true } }),
    loadCheckIns(db, meetingId, n.settings.sections),
    db.session.findFirst({ where: { meetingId, status: "archived" }, orderBy: { date: "desc" }, select: { archivedAt: true } }),
    db.session.findFirst({ where: { meetingId, status: "current" }, select: { absent: true } }),
  ]);
  const lastAt = last?.archivedAt?.getTime() ?? null;
  const expected = participants.filter((p) => !session?.absent.includes(p.personId));
  return { ready: expected.filter((p) => isCheckInReady(checkIns[p.personId], lastAt)).length, total: expected.length };
}

/** A message in the team's words: its title, its text, and the link to the meeting */
function customMessage(input: NotifyInput, custom: { title: string; body: string }): RichMessage {
  const variables = workflowVariables(input);
  const fallback = notifyMessage(input);
  const title = enterprise.workflows.render(custom.title, variables) || fallback.summary;
  const body = enterprise.workflows.render(custom.body, variables);
  const link = safeUrl(input.meetingUrl);
  return {
    summary: title,
    blocks: [
      { kind: "title", text: title },
      ...(body ? [{ kind: "text" as const, text: body }] : []),
      ...(link ? [{ kind: "link" as const, url: link, label: input.settings.teamName }] : []),
    ],
  };
}

/** Sends a delivery. Throws on failure (the job queue retries); the outcome is recorded either way. */
export async function deliver(deliveryId: string, fetchImpl: typeof fetch = outboundFetch): Promise<void> {
  const d = await prisma.delivery.findUnique({ where: { id: deliveryId }, include: { connector: true, rule: true } });
  if (!d || d.status === "sent" || !d.meetingId) return;
  // Its rule deleted meanwhile: nothing goes (its audience and conditions went with it)
  if (!d.ruleId) {
    await prisma.delivery.update({ where: { id: d.id }, data: { status: "skipped", error: "rule deleted" } });
    return;
  }
  const n = await notifiedMeeting(d.meetingId);
  if (!n) return;
  const payload = d.payload as NotifyPayload;
  const input: NotifyInput = {
    event: appEvent(d.event),
    settings: n.settings,
    locale: n.locale,
    meetingUrl: n.appUrl,
    ...payload,
    progress: payload.progress ? await progress(n) : undefined,
  };
  // Workflows (Team): the rule's conditions on what the event carries, then its own words
  const conditions = (d.rule?.conditions ?? []) as { field: string; op: string; value: number }[];
  const custom = (d.rule?.message ?? null) as { title: string; body: string } | null;
  // What the plan no longer includes stops here, without retries: SMS and WhatsApp, a workflow's conditions and
  // words (a downgraded workspace's rules keep their settings, unsent until the plan comes back)
  await loadLicense();
  const plan = await prisma.workspace.findUnique({ where: { id: n.meeting.workspaceId }, select: { plan: true } });
  const missing =
    isPhoneKind(d.connector.kind) && !featureOn("integrations.sms", plan)
      ? "integrations.sms"
      : (conditions.length || custom) && !featureOn("modules.workflows", plan)
        ? "modules.workflows"
        : null;
  if (missing) {
    await prisma.delivery.update({
      where: { id: d.id },
      data: { status: "skipped", attempts: { increment: 1 }, error: `featureNotInPlan {"feature":"${missing}"}` },
    });
    return;
  }
  if (conditions.length && !enterprise.workflows.matches(conditions, workflowFacts(input))) {
    await prisma.delivery.update({ where: { id: d.id }, data: { status: "skipped", attempts: { increment: 1 } } });
    return;
  }
  const message = custom ? customMessage(input, custom) : notifyMessage(input);
  // A retry after a partial failure: the people already reached are not sent it again
  const already = ((d.payload as { sentTo?: string[] }).sentTo ?? []).slice(0, 2000);
  const reached: string[] = [];
  try {
    await sendThrough(
      d.connector,
      (d.rule?.target ?? {}) as Record<string, unknown>,
      d.meetingId,
      {
        id: d.id,
        event: input.event,
        message,
        data: payload,
        meeting: { id: n.meeting.id, name: n.meeting.name, url: n.appUrl },
      },
      fetchImpl,
      undefined,
      { skip: already, sent: (r) => reached.push(r) },
    );
    await prisma.delivery.update({
      where: { id: d.id },
      data: { status: "sent", sentAt: new Date(), attempts: { increment: 1 }, error: null },
    });
  } catch (e) {
    const error = e instanceof AppError ? `${e.key} ${JSON.stringify(e.values)}` : String(e);
    await prisma.delivery.update({
      where: { id: d.id },
      data: {
        status: "failed",
        attempts: { increment: 1 },
        error: error.slice(0, 500),
        payload: { ...(d.payload as object), sentTo: [...already, ...reached] },
      },
    });
    throw e;
  }
}

/** Sends a message through a connector, to a rule's target */
export async function sendThrough(
  connector: { kind: keyof typeof DRIVERS; config: unknown; secret: string },
  target: Record<string, unknown>,
  meetingId: string | null,
  out: Outgoing,
  fetchImpl: typeof fetch = outboundFetch,
  /** Addresses or numbers to send to instead of the rule's audience (a test goes to the person testing) */
  only?: string[],
  /** Recipients reached before (left out), and each one reached now */
  track?: { skip: string[]; sent: (recipient: string) => void },
) {
  const driver = DRIVERS[connector.kind];
  // Email rules name an audience, resolved to addresses when sending
  const resolved =
    only && (connector.kind === "email" || isPhoneKind(connector.kind))
      ? { to: only }
      : connector.kind === "email" && meetingId
        ? { to: await audience(meetingId, target.audience) }
        : isPhoneKind(connector.kind) && meetingId
          ? { to: await audience(meetingId, target.audience, "phone") }
          : target;
  // Those already reached by an earlier try are left out
  if (track?.skip.length && Array.isArray((resolved as { to?: unknown }).to)) {
    const to = ((resolved as { to: string[] }).to ?? []).filter((r) => !track.skip.includes(r));
    if (!to.length) return;
    (resolved as { to: string[] }).to = to;
  }
  await driver.send(
    out,
    {
      config: (connector.config ?? {}) as Record<string, unknown>,
      secret: connector.secret ? decryptSecret(connector.secret) : "",
      target: resolved,
    },
    {
      fetch: fetchImpl,
      // Every address is tried; the first failure is reported once the others went
      sendMail: async ({ to, ...mail }) => {
        const results = await Promise.allSettled(to.map((address) => sendEmail({ to: address, ...mail }).then(() => track?.sent(address))));
        const failed = results.find((r) => r.status === "rejected");
        if (failed) throw failed.reason;
      },
      sent: track?.sent,
      // Loaded when needed: the Teams app reads the meetings, which send their notifications through here
      teamsBot: async (ref, activity) => (await import("../teams")).postToTeams(ref, activity),
    },
  );
}

// ---------- Payloads of the events ----------

export const sessionPayload = (s: { date: string; time: string }): NotifyPayload => ({ session: { date: s.date, time: s.time } });

/** Minutes summary: duration, people, decisions taken in the notes, open actions */
export function minutesPayload(record: MeetingRecord, s: { date: string; time: string }): NotifyPayload {
  const decisions = Object.values(record.notes ?? {})
    .flatMap((text) => decisionsOf(text))
    .slice(0, 10);
  const actions = (record.actions ?? [])
    .filter((a) => a.status !== "done")
    .slice(0, 10)
    .map((a) => ({ text: a.text, owner: record.names?.[a.ownerId] ?? "" }));
  return { ...sessionPayload(s), minutes: { durationMs: record.durationMs, participants: record.participants.length, decisions, actions } };
}

/** Follow-up actions open for more than `days` days, with their owner */
export async function overduePayload(meetingId: string, days: number): Promise<NotifyPayload | null> {
  const before = new Date(Date.now() - days * 86_400_000);
  const actions = await prisma.action.findMany({
    where: { meetingId, status: { not: "done" }, createdAt: { lt: before } },
    include: { owner: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  if (!actions.length) return null;
  return {
    overdue: actions.map((a) => ({
      text: a.text,
      owner: personName(a.owner),
      days: Math.floor((Date.now() - a.createdAt.getTime()) / 86_400_000),
    })),
  };
}

/** Participants whose birthday is that day ("MM-DD") */
export async function birthdayPayload(meetingId: string, monthDay: string): Promise<NotifyPayload | null> {
  const people = await prisma.meetingParticipant.findMany({
    where: { meetingId, role: { not: "observer" }, person: { birthday: monthDay, active: true } },
    select: { person: { select: { firstName: true } } },
  });
  return people.length ? { names: people.map((p) => p.person.firstName) } : null;
}
