import "server-only";
import { type ConnectorKind, DRIVERS } from "@ronde/connectors";
import { NOTIFY_EVENTS, type NotifyEvent } from "@ronde/core/notify";
import type { NotificationsDTO, NotifyRuleDTO } from "@ronde/core/types";
import { workflowCondition, workflowMessage } from "@ronde/core/workflows";
import type { ScopedClient, ScopedTx } from "@ronde/db";
import { z } from "zod";
import { appEvent } from "./dispatch";

// Notification rules of a meeting: "when this happens, send through this connector of the workspace, there".

type Db = ScopedClient | ScopedTx;

/** Where a rule of each kind of connector sends (the connector itself is the destination for webhooks) */
export const RULE_TARGETS: Record<ConnectorKind, z.ZodType<Record<string, string>>> = {
  email: z.object({ audience: z.enum(["participants", "hosts"]) }),
  matrix: DRIVERS.matrix.target as z.ZodType<Record<string, string>>,
  slack: z.object({}),
  teams: z.object({}),
  discord: z.object({}),
  mattermost: z.object({}),
  webhook: z.object({}),
  sms: z.object({ audience: z.enum(["participants", "hosts"]) }),
  whatsapp: z.object({ audience: z.enum(["participants", "hosts"]) }),
};

/** Options of each event */
export const EVENT_OPTIONS: Record<NotifyEvent, z.ZodType<Record<string, number>>> = {
  "session.soon": z.object({ minutesBefore: z.number().int().min(1).max(240) }),
  "session.started": z.object({}),
  "minutes.published": z.object({}),
  "checkin.reminder": z.object({}),
  "action.overdue": z.object({ days: z.number().int().min(1).max(90) }),
  birthday: z.object({}),
};

export const DEFAULT_OPTIONS: Record<NotifyEvent, Record<string, number>> = {
  "session.soon": { minutesBefore: 10 },
  "session.started": {},
  "minutes.published": {},
  "checkin.reminder": {},
  "action.overdue": { days: 7 },
  birthday: {},
};

export const ruleInput = z.object({
  id: z.string().max(50).optional(),
  connectorId: z.string().max(50),
  event: z.enum(NOTIFY_EVENTS),
  target: z.record(z.string(), z.string().max(300)).default({}),
  options: z.record(z.string(), z.number()).default({}),
  conditions: z.array(workflowCondition).max(5).default([]),
  message: workflowMessage.nullable().default(null),
  enabled: z.boolean().default(true),
});
export type RuleInput = z.infer<typeof ruleInput>;

export async function notificationsDTO(db: Db, meetingId: string): Promise<Omit<NotificationsDTO, "canManageConnectors">> {
  const [connectors, rules, deliveries] = await Promise.all([
    db.connector.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, kind: true, name: true } }),
    db.notificationRule.findMany({ where: { meetingId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.delivery.findMany({ where: { meetingId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return {
    connectors,
    rules: rules.map(
      (r): NotifyRuleDTO => ({
        id: r.id,
        connectorId: r.connectorId,
        event: appEvent(r.event),
        target: (r.target ?? {}) as Record<string, string>,
        options: (r.options ?? {}) as Record<string, number>,
        conditions: (r.conditions ?? []) as NotifyRuleDTO["conditions"],
        message: (r.message ?? null) as NotifyRuleDTO["message"],
        enabled: r.enabled,
      }),
    ),
    deliveries: deliveries.map((d) => ({
      id: d.id,
      event: d.event,
      connectorId: d.connectorId,
      status: d.status,
      error: d.error,
      at: d.createdAt.getTime(),
    })),
  };
}
