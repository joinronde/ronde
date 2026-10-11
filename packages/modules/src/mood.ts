import { defineModule, defineOp } from "@ronde/module-sdk";
import { z } from "zod";
import { none, requireActor } from "./shared";

export const mood = defineModule({
  id: "mood",
  category: "facilitation",
  feature: "modules.facilitation",
  defaultEnabled: false,
  icon: "🌤️",
  config: { schema: none, defaults: {} },
  ops: [
    defineOp({
      name: "mood.set",
      permission: "session.participate",
      session: "read",
      input: z.object({ value: z.number().int().min(1).max(5).nullable() }),
      run: async ({ db, m, requireSession, workspaceId }, o) => {
        const by = requireActor(m.viewer);
        const s = requireSession();
        if (o.value === null) await db.mood.deleteMany({ where: { sessionId: s.id, personId: by } });
        else
          await db.mood.upsert({
            where: { sessionId_personId: { sessionId: s.id, personId: by } },
            create: { workspaceId, sessionId: s.id, personId: by, value: o.value },
            update: { value: o.value },
          });
      },
    }),
  ],
});
