import { Prisma } from "@ronde/db";
import { defineModule, defineOp } from "@ronde/module-sdk";
import { z } from "zod";
import { none, str } from "./shared";

// An item, a question or a free message shown big on the shared screen
export const spotlight = defineModule({
  id: "spotlight",
  category: "facilitation",
  feature: "modules.facilitation",
  defaultEnabled: false,
  icon: "🔦",
  config: { schema: none, defaults: {} },
  ops: [
    defineOp({
      name: "spotlight.set",
      permission: "session.run",
      session: "lock",
      input: z.object({ label: str(120), text: str(1000).min(1) }),
      run: async ({ db, requireSession }, o) => {
        await db.session.update({ where: { id: requireSession().id }, data: { spotlight: { label: o.label, text: o.text } } });
      },
    }),
    defineOp({
      name: "spotlight.clear",
      permission: "session.run",
      session: "lock",
      input: none,
      run: async ({ db, requireSession }) => {
        await db.session.update({ where: { id: requireSession().id }, data: { spotlight: Prisma.DbNull } });
      },
    }),
  ],
});
