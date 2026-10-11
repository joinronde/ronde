import { defineModule, defineOp, readConfig } from "@ronde/module-sdk";
import { z } from "zod";
import { requireActor, str } from "./shared";

/** Random question of the bank, different from the previous one when possible */
export function pickIcebreaker(bank: string[], avoid?: string | null): string | null {
  const pool = bank.filter((q) => q.trim() && q !== avoid);
  const from = pool.length ? pool : bank.filter((q) => q.trim());
  return from.length ? from[Math.floor(Math.random() * from.length)]! : null;
}

const schema = z.object({ bank: z.array(z.string().max(300)).max(100) });

export const icebreaker = defineModule({
  id: "icebreaker",
  category: "facilitation",
  feature: "modules.facilitation",
  defaultEnabled: false,
  icon: "🧊",
  config: { schema, defaults: { bank: [] } },
  ops: [
    defineOp({
      name: "icebreaker.set",
      permission: "session.run",
      session: "lock",
      input: z.object({ question: str(300).nullable() }),
      run: async ({ db, requireSession, module }, o) => {
        const s = requireSession();
        const question = o.question ?? pickIcebreaker(readConfig(icebreaker, module?.config).bank, s.icebreaker);
        if (question === s.icebreaker) return;
        // The answers were about the previous question
        await db.icebreakerAnswer.deleteMany({ where: { sessionId: s.id } });
        await db.session.update({ where: { id: s.id }, data: { icebreaker: question } });
      },
    }),
    defineOp({
      name: "icebreaker.answer",
      permission: "session.participate",
      session: "read",
      input: z.object({ text: str(200) }),
      run: async ({ db, m, requireSession, workspaceId }, o) => {
        const by = requireActor(m.viewer);
        const s = requireSession();
        if (!o.text) await db.icebreakerAnswer.deleteMany({ where: { sessionId: s.id, byId: by } });
        else
          await db.icebreakerAnswer.upsert({
            where: { sessionId_byId: { sessionId: s.id, byId: by } },
            create: { workspaceId, sessionId: s.id, byId: by, text: o.text },
            update: { text: o.text },
          });
      },
    }),
    defineOp({
      name: "icebreaker.configure",
      permission: "meeting.configure",
      input: z.object({ bank: z.array(str(300)).max(100) }),
      run: async ({ module }, o) => {
        await module?.setConfig({ bank: o.bank.filter(Boolean) });
      },
    }),
  ],
});
