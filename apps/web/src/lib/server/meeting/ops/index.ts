import "server-only";
import type { Permission } from "@ronde/core/permissions";
import type { Session } from "@ronde/db";
import type { ModuleHandle } from "@ronde/module-sdk";
import type { MODULES } from "@ronde/modules";
import type { z } from "zod";
import { audit } from "../../audit";
import { type BusEvent, publish } from "../../bus";
import { syncMeetingCalendar } from "../../calendars";
import { AccessError, InputError, OpError } from "../../errors";
import { deliver } from "../../inbox";
import { canEncrypt, encryptSecret } from "../../secrets";
import type { MeetingCtx } from "../context";
import { ALL_MODULES, moduleAllowed } from "../modules";
import { configOps } from "./config";
import { controlOps } from "./control";
import type { OpContext, OpDef } from "./define";
import { forgeOps } from "./forges";
import { liveOps } from "./live";
import { notifyOps } from "./notify";
import { projectOps } from "./projects";
import { scheduleOps } from "./schedule";
import { transcriptOps } from "./transcript";

/** Operations kept in the audit log unless they say otherwise: they change how a meeting is set up */
const AUDITED = new Set<Permission>(["meeting.configure", "participants.manage", "minutes.edit", "meeting.delete"]);

const CORE = [...controlOps, ...forgeOps, ...liveOps, ...configOps, ...projectOps, ...scheduleOps, ...notifyOps, ...transcriptOps];

// Every operation by name, with the module it belongs to (null for the core)
const REGISTRY = new Map<string, { def: OpDef; moduleId: string | null }>();
for (const def of CORE) REGISTRY.set(def.name, { def: def as unknown as OpDef, moduleId: null });
for (const mod of ALL_MODULES)
  for (const def of mod.ops) {
    if (REGISTRY.has(def.name)) throw new Error(`Operation ${def.name} is declared twice`);
    REGISTRY.set(def.name, { def: def as unknown as OpDef, moduleId: mod.id });
  }

type AnyOp = (typeof CORE)[number] | (typeof MODULES)[number]["ops"][number];
/** Input fields of an operation; an empty object schema (no field) gives no field */
type InputOf<S extends z.ZodType> = string extends keyof z.input<S> ? object : z.input<S>;
/** An operation as sent by the browser: { op: "<name>", ...input } */
export type Op = AnyOp extends infer D
  ? D extends { name: infer N; input: infer S extends z.ZodType }
    ? { op: N } & InputOf<S>
    : never
  : never;

/** Names of the operations, for tests */
export const OP_NAMES = [...REGISTRY.keys()];

/**
 * Runs an operation of a meeting: reads the input, checks the permission and, for a module operation,
 * that the module is on. It then runs in a transaction confined to the workspace, with the current
 * session locked when the operation asks for it. Events and follow-up work happen once committed.
 */
export async function runOp(m: MeetingCtx, raw: unknown): Promise<void> {
  const { op, ...rest } = (raw && typeof raw === "object" ? raw : {}) as { op?: unknown };
  const entry = typeof op === "string" ? REGISTRY.get(op) : undefined;
  if (!entry) throw new OpError("invalidRequest", { details: `unknown operation ${String(op)}` });
  const { def, moduleId } = entry;
  if (!m.can(def.permission)) throw new AccessError(403, def.permission === "session.run" ? "hostOnly" : "accessDenied");
  const parsed = def.input.safeParse(rest);
  // Said in the caller's language when the answer is written (lib/server/http.ts, lib/server/action.ts)
  if (!parsed.success) throw new InputError(parsed.error.issues);

  const events: BusEvent[] = [];
  const afterCommit: (() => unknown)[] = [];
  let quiet = false;
  const meetingId = m.meeting.id;
  const workspaceId = m.ws.workspace.id;
  const mod = moduleId ? ALL_MODULES.find((x) => x.id === moduleId)! : null;
  if (mod && !moduleAllowed(mod)) throw new AccessError(403, "moduleNotInEdition");

  await m.ws.db.$transaction(
    async (db) => {
      let module: ModuleHandle | null = null;
      if (mod) {
        const row = await db.moduleInstallation.findFirst({ where: { meetingId, moduleId: mod.id } });
        if (!(row ? row.enabled : mod.defaultEnabled)) throw new AccessError(403, "moduleDisabled");
        const key = { meetingId_moduleId: { meetingId, moduleId: mod.id } };
        const save = (data: { config?: object; secret?: string }) =>
          db.moduleInstallation.upsert({
            where: key,
            create: { workspaceId, meetingId, moduleId: mod.id, config: (row?.config ?? mod.config.defaults) as object, ...data },
            update: data,
          });
        module = {
          id: mod.id,
          config: row?.config ?? mod.config.defaults,
          hasSecret: !!row?.secret,
          setConfig: async (config) => {
            await save({ config: config as object });
          },
          // Secrets are encrypted before being stored; without a key, refuse rather than storing them in clear
          setSecret: async (secret) => {
            if (secret && !canEncrypt()) throw new OpError("encryptionNotConfigured");
            await save({ secret: secret ? encryptSecret(secret) : "" });
          },
        };
      }
      let session: Session | null = null;
      if (def.session === "lock") {
        const rows = await db.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Session"
          WHERE "meetingId" = ${meetingId} AND "workspaceId" = ${workspaceId} AND "status" = 'current'
          FOR UPDATE`;
        if (rows[0]) session = await db.session.findFirst({ where: { id: rows[0].id } });
      } else if (def.session === "read") {
        session = await db.session.findFirst({ where: { meetingId, status: "current" } });
      }
      const ctx: OpContext = {
        m,
        db,
        meetingId,
        workspaceId,
        session,
        module,
        requireSession: () => {
          if (!session) throw new OpError("noMeeting");
          return session;
        },
        emit: (event) => events.push(event),
        after: (fn) => afterCommit.push(fn),
        quiet: () => {
          quiet = true;
        },
      };
      await def.run(ctx, parsed.data);
      // Thanks reach the bell of the person thanked
      for (const event of events)
        if (event.kind === "kudo")
          await deliver(db, workspaceId, {
            to: [event.toId],
            kind: "kudo.received",
            actorId: event.fromId,
            meetingId,
            data: { text: event.text },
            href: `/people/${event.toId}`,
          });
      if (def.audit ?? AUDITED.has(def.permission))
        await audit(m.ws, db, { action: def.name, targetType: "meeting", targetId: meetingId, meetingId, data: parsed.data });
      if (session && def.session === "lock") await db.session.updateMany({ where: { id: session.id }, data: { rev: { increment: 1 } } });
    },
    { timeout: 15_000 },
  );

  for (const event of events) await publish(meetingId, event);
  if (!quiet) await publish(meetingId, { kind: "state" });
  // A change of schedule or of people reaches the calendars right away (Team)
  if (m.meeting.calendarAccountId && /^(schedule|participant)\./.test(def.name)) afterCommit.push(() => syncMeetingCalendar(meetingId));
  for (const fn of afterCommit) void Promise.resolve(fn()).catch((e) => console.error(`[op ${def.name}] follow-up failed`, e));
}
