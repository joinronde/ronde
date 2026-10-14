import { baseKeyOf } from "@ronde/core/meeting";
import { REACTION_BURST, REACTION_EMOJIS, REACTION_WINDOW_MS } from "@ronde/core/util";
import { defineModule, defineOp } from "@ronde/module-sdk";
import { z } from "zod";
import { actorId, none } from "./shared";

export const reactions = defineModule({
  id: "reactions",
  category: "facilitation",
  feature: "modules.facilitation",
  defaultEnabled: true,
  icon: "👏",
  config: { schema: none, defaults: {} },
  ops: [
    defineOp({
      name: "reactions.add",
      permission: "session.participate",
      session: "read",
      input: z.object({ emoji: z.enum(REACTION_EMOJIS) }),
      run: async ({ db, m, session, emit, workspaceId }, o) => {
        if (!session) return;
        const by = actorId(m.viewer);
        // Burst from the same person: the screen would stay readable, but it is no longer recorded. Reactions with
        // no author (someone who is not of the meeting) share one allowance, so they cannot flood it either
        if (
          (await db.reaction.count({
            where: { sessionId: session.id, byId: by, createdAt: { gte: new Date(Date.now() - REACTION_WINDOW_MS) } },
          })) >= REACTION_BURST
        )
          return;
        await db.reaction.create({
          data: { workspaceId, sessionId: session.id, emoji: o.emoji, byId: by, stepKey: baseKeyOf(session.stepKey) },
        });
        emit({ kind: "reaction", emoji: o.emoji, byId: by });
      },
    }),
  ],
});
