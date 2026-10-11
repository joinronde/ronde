import "server-only";
import type { Prisma } from "@ronde/db";
import type { VideoAccess, VideoKind } from "@ronde/editions/ee";
import { z } from "zod";
import { enterprise } from "@/ee-bridge";
import { audit } from "./audit";
import type { WorkspaceContext } from "./authz";
import { publish } from "./bus";
import { AccessError, OpError } from "./errors";
import { featureOn, type PlanScope } from "./license";
import type { MeetingCtx } from "./meeting/context";
import { timeZoneOf } from "./meeting/schedule";
import { outboundFetch } from "./outbound";
import { canEncrypt, decryptSecret, encryptSecret } from "./secrets";

// Video accounts of the workspace (Team): Zoom, Google Meet or Microsoft Teams rooms for its meetings

export const videoLinksOn = (ws: PlanScope) => featureOn("integrations.videoLinks", ws);

export const VIDEO_KINDS = ["zoom", "meet", "teams"] as const;

const CONFIG: Record<VideoKind, z.ZodType<Record<string, string>>> = {
  zoom: z.object({ accountId: z.string().min(1).max(100), clientId: z.string().min(1).max(100) }),
  meet: z.object({ clientEmail: z.string().email().max(200), subject: z.string().email().max(200) }),
  teams: z.object({ tenant: z.string().min(1).max(100), clientId: z.string().min(1).max(100), organizer: z.string().email().max(200) }),
};

export interface VideoAccountView {
  id: string;
  kind: VideoKind;
  name: string;
  config: Record<string, string>;
}

export interface VideoAccountInput {
  id?: string;
  kind: VideoKind;
  name: string;
  config: Record<string, string>;
  /** Empty: keep the saved secret */
  secret?: string;
}

export async function listVideoAccounts(db: WorkspaceContext["db"]): Promise<VideoAccountView[]> {
  const rows = await db.videoAccount.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, config: r.config as Record<string, string> }));
}

export async function saveVideoAccount(ctx: WorkspaceContext, input: VideoAccountInput): Promise<{ id: string }> {
  if (!VIDEO_KINDS.includes(input.kind)) throw new OpError("invalidRequest");
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new OpError("nameRequired");
  const config = CONFIG[input.kind].safeParse(input.config);
  if (!config.success) throw new OpError("connectorInvalid", { detail: config.error.issues[0]?.message ?? "" });
  const existing = input.id ? await ctx.db.videoAccount.findFirst({ where: { id: input.id } }) : null;
  if (input.id && !existing) throw new OpError("notFound");
  const secret = input.secret?.trim();
  if (!secret && !existing?.secret) throw new OpError("connectorSecretRequired");
  if (secret && !canEncrypt()) throw new OpError("encryptionNotConfigured");
  const data = { name, config: config.data as Prisma.InputJsonObject, ...(secret ? { secret: encryptSecret(secret.slice(0, 5000)) } : {}) };
  const row = existing
    ? await ctx.db.videoAccount.update({ where: { id: existing.id }, data })
    : await ctx.db.videoAccount.create({ data: { ...data, workspaceId: ctx.workspace.id, kind: input.kind } });
  await audit(ctx, ctx.db, {
    action: existing ? "video.update" : "video.add",
    targetType: "videoAccount",
    targetId: row.id,
    data: { kind: input.kind },
  });
  return { id: row.id };
}

export async function deleteVideoAccount(ctx: WorkspaceContext, id: string): Promise<void> {
  await ctx.db.videoAccount.deleteMany({ where: { id } });
  await audit(ctx, ctx.db, { action: "video.delete", targetType: "videoAccount", targetId: id });
}

const access = (row: { kind: VideoKind; config: unknown; secret: string }): VideoAccess => ({
  kind: row.kind,
  config: row.config as Record<string, string>,
  secret: decryptSecret(row.secret),
  fetch: outboundFetch,
});

export async function testVideoAccount(ctx: WorkspaceContext, id: string) {
  const row = await ctx.db.videoAccount.findFirst({ where: { id } });
  if (!row) throw new OpError("notFound");
  return enterprise.video.test(access(row));
}

/** Opens the lasting room of a meeting with a video account: it becomes the meeting's video link */
export async function createMeetingRoom(m: MeetingCtx, accountId: string): Promise<string> {
  if (!videoLinksOn(m.ws.workspace)) throw new AccessError(403, "featureNotInPlan");
  if (!m.can("meeting.configure")) throw new AccessError(403, "accessDenied");
  const row = await m.ws.db.videoAccount.findFirst({ where: { id: accountId } });
  if (!row) throw new OpError("notFound");
  let url: string;
  try {
    ({ url } = await enterprise.video.createRoom(access(row), { topic: m.meeting.name, timezone: timeZoneOf(m.meeting, m.ws.workspace) }));
  } catch (e) {
    throw new OpError("videoRoomFailed", { detail: e instanceof Error ? e.message : "" });
  }
  const meetingId = m.meeting.id;
  const workspaceId = m.ws.workspace.id;
  // The video module shows the link as is
  const current = await m.ws.db.moduleInstallation.findFirst({ where: { meetingId, moduleId: "video" } });
  const config = { ...((current?.config as object | null) ?? {}), provider: "link" } as Prisma.InputJsonObject;
  await m.ws.db.moduleInstallation.upsert({
    where: { meetingId_moduleId: { meetingId, moduleId: "video" } },
    create: { workspaceId, meetingId, moduleId: "video", enabled: true, config },
    update: { config, enabled: true },
  });
  await m.ws.db.meeting.update({ where: { id: meetingId }, data: { videoUrl: url } });
  await audit(m.ws, m.ws.db, { action: "video.room", targetType: "meeting", targetId: meetingId, meetingId, data: { kind: row.kind } });
  await publish(meetingId, { kind: "state" });
  return url;
}
