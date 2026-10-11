import type { RotatingRole } from "@ronde/core/types";
import { defineModule, defineOp, OpError } from "@ronde/module-sdk";
import { z } from "zod";
import { requireParticipant, str } from "./shared";

// Rotating roles: who facilitates and who takes notes changes at every session, in round-table order
const ROLES = ["facilitator", "noteTaker"] as const satisfies readonly RotatingRole[];
const schema = z.object({ roles: z.array(z.enum(ROLES)).max(ROLES.length) });

export const rotation = defineModule({
  id: "rotation",
  category: "organisation",
  feature: "modules.facilitation",
  defaultEnabled: false,
  icon: "🔄",
  config: { schema, defaults: { roles: [...ROLES] } },
  ops: [
    defineOp({
      name: "rotation.assign",
      permission: "session.run",
      session: "lock",
      input: z.object({ role: z.enum(ROLES), personId: str(50).nullable() }),
      run: async (ctx, o) => {
        const s = ctx.requireSession();
        if (o.personId) await requireParticipant(ctx, o.personId);
        const current = (s.assignments ?? {}) as Partial<Record<RotatingRole, string>>;
        const next = { ...current };
        if (o.personId) next[o.role] = o.personId;
        else delete next[o.role];
        await ctx.db.session.update({ where: { id: s.id }, data: { assignments: next } });
      },
    }),
    defineOp({
      name: "rotation.configure",
      permission: "meeting.configure",
      input: z.object({ roles: z.array(z.enum(ROLES)).max(ROLES.length) }),
      run: async ({ module }, o) => {
        if (!module) throw new OpError("notFound");
        await module.setConfig({ roles: [...new Set(o.roles)] });
      },
    }),
  ],
});
