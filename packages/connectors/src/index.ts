// Notification connectors. Each driver turns a structured message into a platform request; the network
// call goes through the `fetch` it is given, so drivers are tested without any network.

import { createHmac, randomBytes } from "node:crypto";
import { type RichMessage, toDiscord, toHtml, toMarkdown, toSlack, toTeams, toText } from "@ronde/core/notify";
import { IntegrationError } from "@ronde/module-sdk";
import { z } from "zod";

import { CONNECTOR_KINDS, type ConnectorKind, isConnectorKind, isPhoneKind, PHONE_KINDS, PHONE_NUMBER } from "./kinds";

export { CONNECTOR_KINDS, type ConnectorKind, isConnectorKind, isPhoneKind, PHONE_KINDS, PHONE_NUMBER };

export interface Outgoing {
  /** Delivery id, sent to webhooks so receivers can ignore a retry they already handled */
  id: string;
  event: string;
  message: RichMessage;
  /** Raw data of the event, for webhooks */
  data: object;
  meeting: { id: string; name: string; url: string };
}

export interface DriverContext {
  fetch: typeof fetch;
  /** Posts as Ronde's Teams app in a conversation where it was added (a Teams connector linked by the app) */
  teamsBot?: (ref: { serviceUrl: string; conversationId: string }, activity: object) => Promise<void>;
  /** Email through the instance SMTP server */
  sendMail?: (mail: { to: string[]; subject: string; text: string; html: string }) => Promise<void>;
  now?: () => number;
}

export interface Driver {
  kind: ConnectorKind;
  /** Settings shown again in the interface (never secret) */
  config: z.ZodType<Record<string, unknown>>;
  /** What the secret is: a token, a webhook URL, a signing key; null when the driver needs none */
  secret: z.ZodType<string> | null;
  /** Where a rule sends: a Matrix room, email recipients; null when the connector is the destination */
  target: z.ZodType<Record<string, unknown>> | null;
  send: (
    out: Outgoing,
    setup: { config: Record<string, unknown>; secret: string; target: Record<string, unknown> },
    ctx: DriverContext,
  ) => Promise<void>;
}

/** https only, plus http on the local machine (development, tests) */
export const isSafeUrl = (value: string) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
  } catch {
    return false;
  }
};
const url = z.string().trim().max(2000).refine(isSafeUrl, "An https address is needed");

async function post(ctx: DriverContext, target: string, body: string, headers: Record<string, string> = {}): Promise<Response> {
  const host = new URL(target).host;
  const res = await ctx
    .fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Ronde", ...headers },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    })
    .catch(() => {
      throw new IntegrationError("connectorUnreachable", { host });
    });
  if (!res.ok) throw new IntegrationError("connectorRefused", { host, status: res.status });
  return res;
}

const webhookDriver = (kind: ConnectorKind, hosts: RegExp | null, body: (m: RichMessage) => object): Driver => ({
  kind,
  config: z.object({}),
  secret: url.refine((v) => !hosts || hosts.test(new URL(v).hostname), "This is not an address of this service"),
  target: null,
  send: async (out, { secret }, ctx) => {
    await post(ctx, secret, JSON.stringify(body(out.message)));
  },
});

const email: Driver = {
  kind: "email",
  config: z.object({}),
  secret: null,
  target: z.object({ to: z.array(z.email()).max(500) }),
  send: async (out, { target }, ctx) => {
    const to = (target.to as string[] | undefined) ?? [];
    if (!to.length) return;
    if (!ctx.sendMail) throw new IntegrationError("connectorUnreachable", { host: "SMTP" });
    await ctx.sendMail({ to, subject: out.message.summary, text: toText(out.message), html: toHtml(out.message) });
  },
};

// Matrix client-server API: the posting account (ideally a service account) must be a member of the room
const matrix: Driver = {
  kind: "matrix",
  config: z.object({ homeserver: url }),
  secret: z.string().trim().min(10).max(1000),
  target: z.object({
    room: z
      .string()
      .trim()
      .regex(/^[!#][^:\s]+:\S+$/, "A room id like !abc…:example.org or an alias like #team:example.org"),
  }),
  send: async (out, { config, secret, target }, ctx) => {
    const base = String(config.homeserver).replace(/\/$/, "");
    const call = async (method: string, path: string, body?: object) => {
      const res = await ctx
        .fetch(`${base}/_matrix/client/v3${path}`, {
          method,
          headers: { Authorization: `Bearer ${secret}`, ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        })
        .catch(() => {
          throw new IntegrationError("matrixUnreachable", { url: base });
        });
      const data = (await res.json().catch(() => null)) as { room_id?: string; error?: string } | null;
      if (res.ok) return data;
      if (res.status === 401) throw new IntegrationError("matrixTokenRefused");
      if (res.status === 403) throw new IntegrationError("matrixForbidden");
      if (res.status === 404) throw new IntegrationError("matrixRoomNotFound");
      throw new IntegrationError("matrixStatus", { status: res.status, detail: data?.error ?? "" });
    };
    let room = String(target.room ?? "");
    if (!room) throw new IntegrationError("connectorTargetMissing");
    // An alias (#team:example.org) is resolved to the room id first
    if (room.startsWith("#")) {
      const r = await call("GET", `/directory/room/${encodeURIComponent(room)}`);
      if (!r?.room_id) throw new IntegrationError("matrixRoomNotFound");
      room = r.room_id;
    }
    await call("PUT", `/rooms/${encodeURIComponent(room)}/send/m.room.message/ronde-${out.id}`, {
      msgtype: "m.text",
      body: toText(out.message),
      format: "org.matrix.custom.html",
      formatted_body: toHtml(out.message),
    });
  },
};

/** Text of a phone message: the summary and the essentials, short enough for one or two SMS */
export function toPhoneText(m: RichMessage, url: string): string {
  const text = toText(m).trim();
  const short = text.length > 600 ? `${text.slice(0, 597).trimEnd()}…` : text;
  return url && !short.includes(url) ? `${short}\n${url}` : short;
}

// SMS and WhatsApp through Twilio's Messages API. WhatsApp: the sender must be a WhatsApp sender approved in
// Twilio, and WhatsApp only lets a business write first with a template Meta approved: with its Content SID, the
// message goes as that template, its first variable the message and its second the link.
const twilio = (kind: "sms" | "whatsapp"): Driver => ({
  kind,
  config: z.object({
    accountSid: z
      .string()
      .trim()
      .regex(/^AC[0-9a-fA-F]{32}$/, "A Twilio Account SID starts with AC"),
    from: z.string().trim().regex(PHONE_NUMBER, "An international number like +33612345678"),
    ...(kind === "whatsapp"
      ? {
          contentSid: z
            .string()
            .trim()
            .regex(/^(HX[0-9a-fA-F]{32})?$/, "A Twilio Content SID starts with HX")
            .optional(),
        }
      : {}),
  }),
  secret: z.string().trim().min(16).max(200),
  target: z.object({ to: z.array(z.string().regex(PHONE_NUMBER)).max(500) }),
  send: async (out, { config, secret, target }, ctx) => {
    const to = (target.to as string[] | undefined) ?? [];
    if (!to.length) return;
    const sid = String(config.accountSid);
    const prefix = kind === "whatsapp" ? "whatsapp:" : "";
    const template = kind === "whatsapp" && config.contentSid ? String(config.contentSid) : "";
    // A template's variables hold one line each (WhatsApp refuses line breaks and long runs of spaces there)
    const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 1000);
    const content: Record<string, string> = template
      ? {
          ContentSid: template,
          ContentVariables: JSON.stringify({ 1: oneLine(toText(out.message)) || out.message.summary, 2: out.meeting.url || " " }),
        }
      : { Body: toPhoneText(out.message, out.meeting.url) };
    for (const number of to)
      await post(
        ctx,
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        new URLSearchParams({ To: `${prefix}${number}`, From: `${prefix}${config.from}`, ...content }).toString(),
        {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${sid}:${secret}`).toString("base64")}`,
        },
      );
  },
});

/** Signature of a webhook body: hex HMAC-SHA256 of "<timestamp>.<body>" with the connector's key */
export const signWebhook = (key: string, timestamp: string, body: string) =>
  createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex");

/** New signing key for a webhook connector, shown once */
export const newSigningKey = () => `whsec_${randomBytes(24).toString("base64url")}`;

const webhook: Driver = {
  kind: "webhook",
  config: z.object({ url }),
  secret: z.string().min(16).max(200),
  target: null,
  send: async (out, { config, secret }, ctx) => {
    const timestamp = String(Math.floor((ctx.now ?? Date.now)() / 1000));
    const body = JSON.stringify({
      id: out.id,
      event: out.event,
      occurredAt: new Date((ctx.now ?? Date.now)()).toISOString(),
      meeting: out.meeting,
      summary: out.message.summary,
      text: toText(out.message),
      data: out.data,
    });
    await post(ctx, String(config.url), body, {
      "X-Ronde-Event": out.event,
      "X-Ronde-Delivery": out.id,
      "X-Ronde-Timestamp": timestamp,
      "X-Ronde-Signature": `sha256=${signWebhook(secret, timestamp, body)}`,
    });
  },
};

/** The secret of a Teams connector linked by Ronde's Teams app: the bot's conversation in the channel */
export const TEAMS_BOT_SECRET = "teams-bot:";

/**
 * Teams: a "Workflows" (Power Automate) webhook, the legacy Office 365 connectors being retired; or, once a
 * team is linked to Ronde's Teams app, the app itself in the channel it was added to
 */
const teams: Driver = {
  kind: "teams",
  config: z.object({}),
  secret: url,
  target: null,
  send: async (out, { secret }, ctx) => {
    const body = toTeams(out.message);
    if (secret.startsWith(TEAMS_BOT_SECRET)) {
      if (!ctx.teamsBot) throw new IntegrationError("connectorUnreachable", { host: "teams.microsoft.com" });
      return ctx.teamsBot(JSON.parse(secret.slice(TEAMS_BOT_SECRET.length)), body);
    }
    await post(ctx, secret, JSON.stringify(body));
  },
};

export const DRIVERS: Record<ConnectorKind, Driver> = {
  email,
  matrix,
  slack: webhookDriver("slack", /(^|\.)slack\.com$/, toSlack),
  teams,
  discord: webhookDriver("discord", /(^|\.)(discord|discordapp)\.com$/, toDiscord),
  mattermost: webhookDriver("mattermost", null, (m) => ({ text: toMarkdown(m) })),
  webhook,
  sms: twilio("sms"),
  whatsapp: twilio("whatsapp"),
};
