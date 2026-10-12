import "server-only";
import { isPhoneKind } from "@ronde/connectors/kinds";
import { notifyMessage } from "@ronde/core/notify";
import { Prisma } from "@ronde/db";
import { z } from "zod";
import { AccessError, OpError } from "../../errors";
import { featureOn, type PlanScope } from "../../license";
import { notifiedMeeting } from "../../notified-meeting";
import { dbEvent, notifyEvent, sendThrough, sessionPayload } from "../../notify/dispatch";
import { DEFAULT_OPTIONS, EVENT_OPTIONS, RULE_TARGETS, ruleInput } from "../../notify/rules";
import { defineOp } from "./define";

// Notification rules of a meeting, their test, and the host's nudge for check-ins

const workflowsOn = (ws: PlanScope) => featureOn("modules.workflows", ws);

export const notifyOps = [
  defineOp({
    name: "notifications.save",
    permission: "meeting.configure",
    input: z.object({ rules: z.array(ruleInput).max(30) }),
    run: async ({ db, m, meetingId, workspaceId }, o) => {
      const connectors = new Map((await db.connector.findMany({ select: { id: true, kind: true } })).map((c) => [c.id, c.kind]));
      const rules = o.rules.map((r, position) => {
        const kind = connectors.get(r.connectorId);
        if (!kind) throw new OpError("notFound");
        const target = RULE_TARGETS[kind].safeParse(r.target);
        if (!target.success) throw new OpError("connectorTargetMissing");
        const options = EVENT_OPTIONS[r.event].safeParse({ ...DEFAULT_OPTIONS[r.event], ...r.options });
        if (!options.success) throw new OpError("connectorInvalid", { detail: options.error.issues[0]?.message ?? "" });
        // Conditions and custom words are workflows (Team)
        const message = r.message && (r.message.title || r.message.body) ? r.message : null;
        if ((r.conditions.length || message) && !workflowsOn(m.ws.workspace)) throw new AccessError(403, "featureNotInPlan");
        return {
          id: r.id,
          data: {
            connectorId: r.connectorId,
            event: dbEvent(r.event),
            target: target.data as Prisma.InputJsonObject,
            options: options.data as Prisma.InputJsonObject,
            conditions: r.conditions as Prisma.InputJsonArray,
            message: message ? (message as Prisma.InputJsonObject) : Prisma.DbNull,
            enabled: r.enabled,
            position,
          },
        };
      });
      const existing = new Set((await db.notificationRule.findMany({ where: { meetingId }, select: { id: true } })).map((r) => r.id));
      const kept = rules.filter((r) => r.id && existing.has(r.id)).map((r) => r.id!);
      await db.notificationRule.deleteMany({ where: { meetingId, id: { notIn: kept } } });
      for (const r of rules) {
        if (r.id && existing.has(r.id)) await db.notificationRule.update({ where: { id: r.id }, data: r.data });
        else await db.notificationRule.create({ data: { workspaceId, meetingId, ...r.data } });
      }
    },
  }),
  defineOp({
    name: "notifications.test",
    permission: "meeting.configure",
    input: z.object({ connectorId: z.string().max(50), target: z.record(z.string(), z.string().max(300)).default({}) }),
    run: async ({ db, meetingId, quiet, m }, o) => {
      quiet();
      const connector = await db.connector.findFirst({ where: { id: o.connectorId } });
      if (!connector) throw new OpError("notFound");
      // SMS and WhatsApp come with Team: a connector kept from before sends no test either
      if (isPhoneKind(connector.kind) && !featureOn("integrations.sms", m.ws.workspace)) throw new AccessError(403, "featureNotInPlan");
      const target = RULE_TARGETS[connector.kind].safeParse(o.target);
      if (!target.success) throw new OpError("connectorTargetMissing");
      const n = await notifiedMeeting(meetingId);
      if (!n) throw new OpError("notFound");
      await sendThrough(connector, target.data, meetingId, {
        id: `test-${Date.now()}`,
        event: "test",
        message: notifyMessage({ event: "test", settings: n.settings, locale: n.locale, meetingUrl: n.appUrl }),
        data: {},
        meeting: { id: meetingId, name: n.meeting.name, url: n.appUrl },
      });
    },
  }),
  defineOp({
    name: "notifications.nudge",
    permission: "session.run",
    session: "read",
    input: z.object({}),
    run: async ({ requireSession, meetingId, quiet }) => {
      quiet();
      const s = requireSession();
      // Sent through the "check-in reminder" rules, right away: the host sees a failure
      const sent = await notifyEvent(
        meetingId,
        "checkin.reminder",
        `nudge-${Date.now()}`,
        { ...sessionPayload(s), progress: true },
        { inline: true },
      );
      if (!sent) throw new OpError("notifyNoRule");
    },
  }),
];
