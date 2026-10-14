import "server-only";
import { z } from "zod";
import { deleteForgeConnection, FORGE_KINDS, saveForgeConnection, testForgeConnection, useInMeeting } from "../../forges";
import { defineOp } from "./define";

// A meeting's own GitLab and GitHub connections: added by its hosts, seen by this meeting alone, used right away

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
    run: async ({ m, meetingId, workspaceId }, o) => {
      const { id: connection } = await saveForgeConnection(m.ws, o, meetingId);
      await useInMeeting(m.ws.db, workspaceId, meetingId, o.kind, connection);
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
    run: async ({ m, meetingId }, o) => {
      const row = await m.ws.db.forgeConnection.findFirst({ where: { id: o.id, meetingId }, select: { kind: true } });
      await saveForgeConnection(m.ws, { ...o, kind: row?.kind ?? "gitlab" }, meetingId);
    },
  }),
  defineOp({
    name: "forge.test",
    permission: "meeting.configure",
    input: z.object({ id }),
    audit: false,
    run: async ({ m, meetingId }, o) => {
      await testForgeConnection(m.ws, o.id, meetingId);
    },
  }),
  defineOp({
    name: "forge.remove",
    permission: "meeting.configure",
    // Kept in the log by forges.ts, without the token
    audit: false,
    input: z.object({ id }),
    run: async ({ m, meetingId }, o) => {
      await deleteForgeConnection(m.ws, o.id, meetingId);
    },
  }),
];
