import "server-only";
import { type ConnectorKind, DRIVERS, isConnectorKind, isPhoneKind, newSigningKey } from "@ronde/connectors";
import { notifyMessage } from "@ronde/core/notify";
import type { Prisma } from "@ronde/db";
import { resolveLocale } from "@ronde/i18n";
import { z } from "zod";
import type { WorkspaceContext } from "../authz";
import { env } from "../env";
import { OpError } from "../errors";
import { featureOn } from "../license";
import { canEncrypt, encryptSecret } from "../secrets";
import { sendThrough } from "./dispatch";

// Connectors of a workspace: the channels its meetings can notify. Managed by workspace admins; the
// secret (token, webhook address, signing key) is encrypted and never sent back to the browser.

export interface ConnectorView {
  id: string;
  kind: ConnectorKind;
  name: string;
  /** Settings that are not secret (homeserver, webhook address) */
  config: Record<string, unknown>;
  secretSet: boolean;
  /** Notification rules of meetings using it */
  rules: number;
  last: { status: "pending" | "sent" | "failed" | "skipped"; error: string | null; at: number } | null;
}

export async function listConnectors(ctx: WorkspaceContext): Promise<ConnectorView[]> {
  const rows = await ctx.db.connector.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { rules: true } },
      deliveries: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, error: true, createdAt: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    kind: c.kind,
    name: c.name,
    config: (c.config ?? {}) as Record<string, unknown>,
    secretSet: !!c.secret,
    rules: c._count.rules,
    last: c.deliveries[0]
      ? { status: c.deliveries[0].status, error: c.deliveries[0].error, at: c.deliveries[0].createdAt.getTime() }
      : null,
  }));
}

export interface ConnectorInput {
  id?: string;
  kind: string;
  name: string;
  config: Record<string, unknown>;
  /** New secret; left out to keep the saved one */
  secret?: string;
}

const nameSchema = z.string().trim().min(1).max(80);

/** Creates or updates a connector; returns its id and, for a new webhook, the signing key (shown once) */
export async function saveConnector(ctx: WorkspaceContext, input: ConnectorInput): Promise<{ id: string; signingKey: string | null }> {
  if (!isConnectorKind(input.kind)) throw new OpError("connectorKindUnknown");
  // SMS and WhatsApp reminders come with Team
  if (isPhoneKind(input.kind) && !featureOn("integrations.sms", ctx.workspace)) throw new OpError("featureNotInPlan");
  const driver = DRIVERS[input.kind];
  const name = nameSchema.safeParse(input.name);
  if (!name.success) throw new OpError("nameRequired");
  const config = driver.config.safeParse(input.config ?? {});
  if (!config.success) throw new OpError("connectorInvalid", { detail: config.error.issues[0]?.message ?? "" });

  const existing = input.id ? await ctx.db.connector.findFirst({ where: { id: input.id }, select: { kind: true, secret: true } }) : null;
  if (input.id && !existing) throw new OpError("notFound");
  if (existing && existing.kind !== input.kind) throw new OpError("connectorKindUnknown");

  // A new webhook gets its signing key generated here
  let signingKey: string | null = null;
  let secret = input.secret?.trim();
  if (input.kind === "webhook" && !existing && !secret) secret = signingKey = newSigningKey();
  if (secret) {
    const parsed = driver.secret?.safeParse(secret);
    if (parsed && !parsed.success) throw new OpError("connectorInvalid", { detail: parsed.error.issues[0]?.message ?? "" });
    if (!canEncrypt()) throw new OpError("encryptionNotConfigured");
  } else if (driver.secret && !existing?.secret) throw new OpError("connectorSecretRequired");

  const data = {
    name: name.data,
    config: config.data as Prisma.InputJsonObject,
    ...(secret ? { secret: encryptSecret(secret) } : {}),
  };
  if (existing && input.id) {
    await ctx.db.connector.update({ where: { id: input.id }, data });
    return { id: input.id, signingKey };
  }
  const created = await ctx.db.connector.create({
    data: { ...data, workspaceId: ctx.workspace.id, kind: input.kind, createdById: ctx.user.id },
  });
  return { id: created.id, signingKey };
}

export async function deleteConnector(ctx: WorkspaceContext, id: string): Promise<void> {
  const rules = await ctx.db.notificationRule.count({ where: { connectorId: id } });
  if (rules) throw new OpError("connectorInUse");
  const { count } = await ctx.db.connector.deleteMany({ where: { id } });
  if (!count) throw new OpError("notFound");
}

/** Sends a test message; email goes to the admin who asks, Matrix to the room they give */
export async function testConnector(ctx: WorkspaceContext, id: string, room?: string): Promise<void> {
  const connector = await ctx.db.connector.findFirst({ where: { id } });
  if (!connector) throw new OpError("notFound");
  const locale = resolveLocale(ctx.user.locale, ctx.workspace.locale);
  const appUrl = env.appUrl();
  const message = notifyMessage({
    event: "test",
    settings: { teamName: ctx.workspace.name, targetMin: 0, speakSec: 0, videoUrl: "", sections: [] },
    locale,
    meetingUrl: appUrl ? `${appUrl}/w/${ctx.workspace.slug}` : "",
  });
  // Email to the admin who asks; SMS and WhatsApp to their own mobile number; Matrix to the room they give
  let target: Record<string, unknown> = {};
  if (connector.kind === "email") target = { to: [ctx.user.email] };
  else if (connector.kind === "matrix") target = { room: room?.trim() ?? "" };
  else if (isPhoneKind(connector.kind)) {
    const me = await ctx.db.person.findFirst({ where: { id: ctx.member.personId }, select: { phone: true } });
    if (!me?.phone) throw new OpError("phoneMissing");
    target = { to: [me.phone] };
  }
  await sendThrough(connector, target, null, {
    id: `test-${Date.now()}`,
    event: "test",
    message,
    data: {},
    meeting: { id: "", name: ctx.workspace.name, url: appUrl },
  });
}
