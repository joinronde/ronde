import "server-only";
import { can } from "@ronde/core/permissions";
import { Prisma, prisma, scoped } from "@ronde/db";
import type { TicketRef, TrackerAccess, TrackerKind } from "@ronde/editions/ee";
import { formatters, resolveLocale } from "@ronde/i18n";
import { z } from "zod";
import { enterprise } from "@/ee-bridge";
import { audit } from "./audit";
import type { WorkspaceContext } from "./authz";
import { AccessError, OpError } from "./errors";
import { featureOn, type PlanScope } from "./license";
import { personName } from "./meeting/dto";
import { outboundFetch } from "./outbound";
import { readSourceOf, TOKEN_FORMAT } from "./project-sources";
import { publicUrl } from "./public-url";
import { canEncrypt, decryptSecret, encryptSecret } from "./secrets";

// Issue trackers (Team): a follow-up action becomes a ticket; once the ticket is closed, the action is done

export const trackersOn = (ws: PlanScope) => featureOn("integrations.writeBack", ws);

export const TRACKER_KINDS = ["jira", "linear", "gitlab", "github"] as const;

/** What each tracker needs to know where tickets go */
const CONFIG: Record<TrackerKind, z.ZodType<Record<string, string>>> = {
  jira: z.object({
    site: z.string().url().max(200),
    project: z.string().regex(/^[A-Z][A-Z0-9_]{0,19}$/),
    email: z.string().email().max(200),
  }),
  linear: z.object({ team: z.string().min(1).max(100) }),
  gitlab: z.object({ url: z.string().url().max(200), project: z.string().min(1).max(200) }),
  github: z.object({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/) }),
};

export interface TrackerView {
  id: string;
  kind: TrackerKind;
  name: string;
  config: Record<string, string>;
}

export interface TrackerInput {
  id?: string;
  kind: TrackerKind;
  name: string;
  config: Record<string, string>;
  /** Empty: keep the saved token */
  token?: string;
}

/** What the database keeps on an action once its ticket exists */
export interface ExternalRef extends TicketRef {
  trackerId: string;
  closed: boolean;
}

export const readRef = (raw: unknown): ExternalRef | null =>
  raw && typeof raw === "object" && "trackerId" in raw && "key" in raw ? (raw as ExternalRef) : null;

export async function listTrackers(ctx: WorkspaceContext): Promise<TrackerView[]> {
  const rows = await ctx.db.issueTracker.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, config: r.config as Record<string, string> }));
}

export async function saveTracker(ctx: WorkspaceContext, input: TrackerInput): Promise<{ id: string }> {
  if (!TRACKER_KINDS.includes(input.kind)) throw new OpError("invalidRequest");
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new OpError("nameRequired");
  const config = CONFIG[input.kind].safeParse(input.config);
  if (!config.success) throw new OpError("connectorInvalid", { detail: config.error.issues[0]?.message ?? "" });
  const existing = input.id ? await ctx.db.issueTracker.findFirst({ where: { id: input.id } }) : null;
  if (input.id && !existing) throw new OpError("notFound");
  const token = input.token?.trim();
  if (!token && !existing?.secret) throw new OpError("connectorSecretRequired");
  if (token && !TOKEN_FORMAT.test(token)) throw new OpError("tokenInvalid");
  if (token && !canEncrypt()) throw new OpError("encryptionNotConfigured");
  const data = {
    name,
    config: config.data as Prisma.InputJsonObject,
    ...(token ? { secret: encryptSecret(token.slice(0, 500)) } : {}),
  };
  const row = existing
    ? await ctx.db.issueTracker.update({ where: { id: existing.id }, data })
    : await ctx.db.issueTracker.create({ data: { ...data, workspaceId: ctx.workspace.id, kind: input.kind } });
  await audit(ctx, ctx.db, {
    action: existing ? "trackers.update" : "trackers.add",
    targetType: "tracker",
    targetId: row.id,
    data: { kind: input.kind },
  });
  return { id: row.id };
}

export async function deleteTracker(ctx: WorkspaceContext, id: string): Promise<void> {
  // The projects it kept in sync stay, and say why they no longer follow their tool
  for (const p of await ctx.db.project.findMany({ where: { sourceTrackerId: id }, select: { id: true, source: true } })) {
    const source = readSourceOf(p.source);
    if (source)
      await ctx.db.project.update({
        where: { id: p.id },
        data: {
          sourceTrackerId: null,
          source: { ...source, stopped: "trackerRemoved", problem: null } as unknown as Prisma.InputJsonObject,
        },
      });
  }
  await ctx.db.issueTracker.deleteMany({ where: { id } });
  await audit(ctx, ctx.db, { action: "trackers.delete", targetType: "tracker", targetId: id });
}

const access = (row: { kind: TrackerKind; config: unknown; secret: string }): TrackerAccess => ({
  kind: row.kind,
  config: row.config as Record<string, string>,
  token: decryptSecret(row.secret),
  fetch: outboundFetch,
});

export async function testTracker(ctx: WorkspaceContext, id: string) {
  const row = await ctx.db.issueTracker.findFirst({ where: { id } });
  if (!row) throw new OpError("notFound");
  return enterprise.trackers.test(access(row));
}

/** Opens the ticket of a follow-up action; the owner of the action or a host of its meeting may do it */
export async function createTicket(ctx: WorkspaceContext, actionId: string, trackerId: string): Promise<ExternalRef> {
  if (!trackersOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
  const action = await ctx.db.action.findFirst({
    where: { id: actionId },
    include: { owner: { select: { firstName: true, lastName: true, email: true, handles: true } } },
  });
  const meeting = action && (await ctx.db.meeting.findFirst({ where: { id: action.meetingId, archivedAt: null }, select: { name: true } }));
  if (!action || !meeting) throw new AccessError(403, "accessDenied");
  // As in the meeting: the owner moves their action forward, a host (or a workspace admin) any action
  const participant = await ctx.db.meetingParticipant.findFirst({
    where: { meetingId: action.meetingId, personId: ctx.member.personId },
    select: { role: true },
  });
  const host = can({ ...ctx.principal, meetingRole: participant?.role ?? null }, "session.run", ctx.workspace.settings);
  if (!host && action.ownerId !== ctx.member.personId) throw new AccessError(403, "ownActionsOnly");
  if (readRef(action.externalRef)) throw new OpError("ticketExists");
  const tracker = await ctx.db.issueTracker.findFirst({ where: { id: trackerId } });
  if (!tracker) throw new OpError("notFound");
  const f = formatters(resolveLocale(ctx.workspace.locale));
  const handles = (action.owner.handles ?? {}) as { gitlab?: string; github?: string };
  const link = await publicUrl(`/w/${ctx.workspace.slug}/m/${action.meetingId}`);
  const body = [
    `${meeting.name}${action.originDate ? ` · ${f.dateShort(action.originDate)}` : ""}`,
    `${personName(action.owner)}`,
    ...(action.originText && action.originText !== action.text ? [`> ${action.originText}`] : []),
    link,
  ].join("\n\n");
  let ref: TicketRef;
  try {
    ref = await enterprise.trackers.create(access(tracker), {
      title: action.text,
      body,
      assignee: { ...handles, ...(action.owner.email ? { email: action.owner.email } : {}) },
    });
  } catch (e) {
    throw new OpError("ticketFailed", { detail: e instanceof Error ? e.message : "" });
  }
  const external: ExternalRef = { ...ref, trackerId: tracker.id, closed: false };
  await ctx.db.action.update({ where: { id: action.id }, data: { externalRef: external as unknown as Prisma.InputJsonObject } });
  await audit(ctx, ctx.db, {
    action: "trackers.ticket",
    targetType: "action",
    targetId: action.id,
    meetingId: action.meetingId,
    data: { key: ref.key },
  });
  return external;
}

/** Every 15 minutes: open actions whose ticket was closed become done */
export async function syncTickets(): Promise<number> {
  const actions = await prisma.action.findMany({
    where: {
      status: { not: "done" },
      externalRef: { not: Prisma.DbNull },
      meeting: { archivedAt: null, workspace: { deletedAt: null, suspendedAt: null } },
    },
    select: { id: true, workspaceId: true, externalRef: true, meeting: { select: { workspace: { select: { plan: true } } } } },
    take: 500,
  });
  const trackers = new Map<string, TrackerAccess | null>();
  let done = 0;
  for (const a of actions) {
    const ref = readRef(a.externalRef);
    if (!ref || ref.closed || !trackersOn(a.meeting.workspace)) continue;
    if (!trackers.has(ref.trackerId)) {
      const row = await scoped(prisma, a.workspaceId).issueTracker.findFirst({ where: { id: ref.trackerId } });
      trackers.set(ref.trackerId, row ? access(row) : null);
    }
    const tracker = trackers.get(ref.trackerId);
    if (!tracker) continue;
    try {
      if (!(await enterprise.trackers.closed(tracker, ref))) continue;
    } catch (e) {
      console.error(`[trackers] checking ${ref.key} failed`, e);
      continue;
    }
    await prisma.action.update({
      where: { id: a.id },
      data: { status: "done", doneAt: new Date(), externalRef: { ...ref, closed: true } as unknown as Prisma.InputJsonObject },
    });
    done++;
  }
  return done;
}
