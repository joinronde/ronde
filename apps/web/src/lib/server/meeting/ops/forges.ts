import "server-only";
import type { ScopedClient } from "@ronde/db";
import { z } from "zod";
import { deleteForgeConnection, FORGE_KINDS, saveForgeConnection, testForgeConnection, useInMeeting } from "../../forges";
import { defineOp, type OpContext } from "./define";

// A meeting's own GitLab and GitHub connections: added by its hosts, seen by this meeting alone, used right away.
// They are written within the operation's transaction: a connection is never left half added

/** The workspace's context, writing within the operation's transaction */
const inTx = ({ m, db }: Pick<OpContext, "m" | "db">) => ({ ...m.ws, db: db as unknown as ScopedClient });

const id = z.string().trim().min(1).max(60);

export const forgeOps = [
  defineOp({
    name: "forge.add",
    permission: "meeting.configure",
    // Kept in the log by forges.ts, without the token
    audit: false,
    input: z.object({
      kind: z.enum(FORGE_KINDS),
      name: z.string().trim().max(60).default(""),
      url: z.string().trim().max(200).default(""),
      token: z.string().trim().min(1).max(500),
    }),
    run: async (ctx, o) => {
      const ws = inTx(ctx);
      const { id: connection } = await saveForgeConnection(ws, o, ctx.meetingId);
      await useInMeeting(ws.db, ctx.workspaceId, ctx.meetingId, o.kind, connection);
    },
  }),
  defineOp({
    name: "forge.update",
    permission: "meeting.configure",
    // Kept in the log by forges.ts, without the token
    audit: false,
    /** token missing or empty: unchanged */
    input: z.object({
      id,
      name: z.string().trim().max(60),
      url: z.string().trim().max(200).default(""),
      token: z.string().trim().max(500).optional(),
    }),
    run: async (ctx, o) => {
      const ws = inTx(ctx);
      const row = await ws.db.forgeConnection.findFirst({ where: { id: o.id, meetingId: ctx.meetingId }, select: { kind: true } });
      await saveForgeConnection(ws, { ...o, kind: row?.kind ?? "gitlab" }, ctx.meetingId);
    },
  }),
  defineOp({
    name: "forge.test",
    permission: "meeting.configure",
    input: z.object({ id }),
    audit: false,
    run: async (ctx, o) => {
      await testForgeConnection(inTx(ctx), o.id, ctx.meetingId);
    },
  }),
  defineOp({
    name: "forge.remove",
    permission: "meeting.configure",
    // Kept in the log by forges.ts, without the token
    audit: false,
    input: z.object({ id }),
    run: async (ctx, o) => {
      await deleteForgeConnection(inTx(ctx), o.id, ctx.meetingId);
    },
  }),
];
