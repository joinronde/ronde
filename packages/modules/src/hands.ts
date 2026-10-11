import { baseKeyOf } from "@ronde/core/meeting";
import { AccessError, defineModule, defineOp, OpError } from "@ronde/module-sdk";
import { z } from "zod";
import { actorId, none, requireActor, requireParticipant, str } from "./shared";

// Raised hands and questions: a "Questions" step follows the turn where they were raised
export const hands = defineModule({
  id: "hands",
  category: "facilitation",
  feature: "modules.facilitation",
  defaultEnabled: true,
  icon: "✋",
  config: { schema: none, defaults: {} },
  ops: [
    defineOp({
      name: "hands.add",
      permission: "session.participate",
      session: "read",
      input: z.object({ type: z.enum(["hand", "question"]), text: str(500).default(""), targetId: str(50).nullable().default(null) }),
      run: async (ctx, o) => {
        const { db, m, workspaceId } = ctx;
        const by = requireActor(m.viewer);
        const s = ctx.requireSession();
        if (o.type === "question" && !o.text) throw new OpError("emptyQuestion");
        if (o.targetId) await requireParticipant(ctx, o.targetId);
        if (o.type === "hand" && (await db.interaction.findFirst({ where: { sessionId: s.id, byId: by, type: "hand", resolved: false } })))
          return;
        await db.interaction.create({
          data: { workspaceId, sessionId: s.id, type: o.type, byId: by, targetId: o.targetId, text: o.text, stepKey: baseKeyOf(s.stepKey) },
        });
        // Raised hand or question: shown on screen right away, like a reaction
        ctx.emit({ kind: "reaction", emoji: o.type === "hand" ? "✋" : "❓", byId: by });
      },
    }),
    defineOp({
      name: "hands.resolve",
      permission: "session.run",
      input: z.object({ id: str(50), resolved: z.boolean() }),
      run: async ({ db, meetingId }, o) => {
        await db.interaction.updateMany({ where: { id: o.id, session: { meetingId } }, data: { resolved: o.resolved } });
      },
    }),
    defineOp({
      name: "hands.delete",
      permission: "session.participate",
      input: z.object({ id: str(50) }),
      run: async ({ db, m, meetingId }, o) => {
        const it = await db.interaction.findFirst({ where: { id: o.id, session: { meetingId } } });
        if (!it) return;
        if (it.byId !== actorId(m.viewer) && !m.viewer.isHost) throw new AccessError(403, "ownRequestsOnly");
        await db.interaction.delete({ where: { id: it.id } });
      },
    }),
  ],
});
