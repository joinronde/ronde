import { defineModule, defineOp, OpError } from "@ronde/module-sdk";
import { z } from "zod";
import { actorId, none, str } from "./shared";

// Parking lot: a subject that comes up off-topic is set aside in one click, shown apart from today's topics,
// listed in the minutes, then becomes an open topic of the next session.
export const parking = defineModule({
  id: "parking",
  category: "organisation",
  feature: "modules.facilitation",
  defaultEnabled: false,
  icon: "🅿️",
  config: { schema: none, defaults: {} },
  ops: [
    defineOp({
      name: "parking.add",
      permission: "session.run",
      input: z.object({ text: str(300).min(1) }),
      run: async ({ db, meetingId, workspaceId, m }, o) => {
        if ((await db.topic.count({ where: { meetingId, parked: true } })) >= 50) throw new OpError("parkingFull");
        await db.topic.create({ data: { workspaceId, meetingId, text: o.text, byId: actorId(m.viewer), parked: true } });
      },
    }),
    defineOp({
      name: "parking.discuss",
      permission: "session.run",
      input: z.object({ id: str(50) }),
      run: async ({ db, meetingId }, o) => {
        const { count } = await db.topic.updateMany({ where: { id: o.id, meetingId, parked: true }, data: { parked: false } });
        if (!count) throw new OpError("notFound");
      },
    }),
  ],
});
