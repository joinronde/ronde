import { defineModule, defineOp, OpError } from "@ronde/module-sdk";
import { z } from "zod";
import { none, requireActor } from "./shared";

// How useful the meeting was: at its wrap-up, everyone rates it from 1 (a waste of time) to 5 (excellent),
// anonymously. The room sees the average forming; the stats follow it session after session.
export const rating = defineModule({
  id: "rating",
  category: "facilitation",
  feature: "modules.facilitation",
  defaultEnabled: true,
  icon: "⭐",
  config: { schema: none, defaults: {} },
  ops: [
    defineOp({
      name: "rating.set",
      permission: "session.participate",
      session: "read",
      input: z.object({ value: z.number().int().min(1).max(5).nullable() }),
      run: async ({ db, m, requireSession, workspaceId }, o) => {
        const by = requireActor(m.viewer);
        const s = requireSession();
        // Rated once the meeting has been through: at its wrap-up, or ended and not archived yet
        if (s.stepKey !== "end" && !s.endedAt) throw new OpError("ratingNotYet");
        if (o.value === null) await db.rating.deleteMany({ where: { sessionId: s.id, personId: by } });
        else
          await db.rating.upsert({
            where: { sessionId_personId: { sessionId: s.id, personId: by } },
            create: { workspaceId, sessionId: s.id, personId: by, value: o.value },
            update: { value: o.value },
          });
      },
    }),
  ],
});
