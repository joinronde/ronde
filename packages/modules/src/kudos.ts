import { AccessError, defineModule, defineOp, OpError } from "@ronde/module-sdk";
import { z } from "zod";
import { actorId, none, requireActor, requireParticipant, str } from "./shared";

export const kudos = defineModule({
  id: "kudos",
  category: "facilitation",
  feature: "modules.facilitation",
  defaultEnabled: true,
  icon: "💜",
  config: { schema: none, defaults: {} },
  ops: [
    defineOp({
      name: "kudos.add",
      permission: "session.participate",
      session: "read",
      input: z.object({ toId: str(50), text: str(200).min(1) }),
      run: async (ctx, o) => {
        const by = requireActor(ctx.m.viewer);
        if (o.toId === by) throw new OpError("pickSomeoneElse");
        await requireParticipant(ctx, o.toId, "unknownRecipient");
        const s = ctx.requireSession();
        await ctx.db.kudo.create({ data: { workspaceId: ctx.workspaceId, sessionId: s.id, fromId: by, toId: o.toId, text: o.text } });
        ctx.emit({ kind: "kudo", fromId: by, toId: o.toId, text: o.text });
      },
    }),
    defineOp({
      name: "kudos.delete",
      permission: "session.participate",
      input: z.object({ id: str(50) }),
      run: async ({ db, m, meetingId }, o) => {
        const k = await db.kudo.findFirst({ where: { id: o.id, session: { meetingId } } });
        if (!k) return;
        if (k.fromId !== actorId(m.viewer) && !m.viewer.isHost) throw new AccessError(403, "ownKudosOnly");
        await db.kudo.delete({ where: { id: k.id } });
      },
    }),
  ],
});
