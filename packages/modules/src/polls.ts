import { defineModule, defineOp, OpError } from "@ronde/module-sdk";
import { z } from "zod";
import { none, requireActor, str } from "./shared";

// Polls: a question asked during the session, answered from "My screen", results on the shared screen

export const SCALE = ["1", "2", "3", "4", "5"];

/** The values an answer may hold, for a poll */
export function validAnswer(poll: { kind: "single" | "multiple" | "scale" | "words"; options: string[] }, values: string[]): boolean {
  const unique = new Set(values).size === values.length;
  if (!values.length || !unique) return false;
  switch (poll.kind) {
    case "single":
      return values.length === 1 && poll.options.includes(values[0]!);
    case "multiple":
      return values.every((v) => poll.options.includes(v));
    case "scale":
      return values.length === 1 && SCALE.includes(values[0]!);
    case "words":
      return values.length <= 3 && values.every((v) => v.trim().length > 0 && v.length <= 30);
  }
}

export const polls = defineModule({
  id: "polls",
  category: "organisation",
  feature: "modules.facilitation",
  defaultEnabled: false,
  icon: "📊",
  config: { schema: none, defaults: {} },
  ops: [
    defineOp({
      name: "polls.create",
      permission: "session.run",
      session: "read",
      input: z.object({
        question: str(200).min(1),
        kind: z.enum(["single", "multiple", "scale", "words"]),
        options: z.array(str(80).min(1)).max(10).default([]),
        anonymous: z.boolean().default(true),
      }),
      run: async ({ db, requireSession, workspaceId }, o) => {
        const s = requireSession();
        const options = [...new Set(o.options)];
        if ((o.kind === "single" || o.kind === "multiple") && options.length < 2) throw new OpError("pollNeedsOptions");
        await db.poll.create({
          data: {
            workspaceId,
            sessionId: s.id,
            question: o.question,
            kind: o.kind,
            options: o.kind === "single" || o.kind === "multiple" ? options : [],
            anonymous: o.anonymous,
          },
        });
      },
    }),
    defineOp({
      name: "polls.answer",
      permission: "session.participate",
      session: "read",
      input: z.object({ pollId: str(50), values: z.array(str(80)).max(10) }),
      run: async ({ db, m, requireSession, workspaceId }, o) => {
        const poll = await db.poll.findFirst({ where: { id: o.pollId, sessionId: requireSession().id } });
        if (!poll) throw new OpError("notFound");
        if (!poll.open) throw new OpError("pollClosed");
        const values = o.values.map((v) => v.trim()).filter(Boolean);
        if (!validAnswer(poll, values)) throw new OpError("pollInvalidAnswer");
        const personId = requireActor(m.viewer);
        await db.pollAnswer.upsert({
          where: { pollId_personId: { pollId: poll.id, personId } },
          create: { workspaceId, pollId: poll.id, personId, values },
          update: { values },
        });
      },
    }),
    defineOp({
      name: "polls.close",
      permission: "session.run",
      session: "read",
      input: z.object({ pollId: str(50), open: z.boolean().default(false) }),
      run: async ({ db, requireSession }, o) => {
        const { count } = await db.poll.updateMany({ where: { id: o.pollId, sessionId: requireSession().id }, data: { open: o.open } });
        if (!count) throw new OpError("notFound");
      },
    }),
    defineOp({
      name: "polls.show",
      permission: "session.run",
      session: "lock",
      input: z.object({ pollId: str(50).nullable() }),
      run: async ({ db, requireSession }, o) => {
        const s = requireSession();
        if (o.pollId && !(await db.poll.findFirst({ where: { id: o.pollId, sessionId: s.id }, select: { id: true } })))
          throw new OpError("notFound");
        await db.session.update({ where: { id: s.id }, data: { shownPollId: o.pollId } });
      },
    }),
    defineOp({
      name: "polls.delete",
      permission: "session.run",
      session: "lock",
      input: z.object({ pollId: str(50) }),
      run: async ({ db, requireSession }, o) => {
        const s = requireSession();
        const { count } = await db.poll.deleteMany({ where: { id: o.pollId, sessionId: s.id } });
        if (!count) throw new OpError("notFound");
        if (s.shownPollId === o.pollId) await db.session.update({ where: { id: s.id }, data: { shownPollId: null } });
      },
    }),
  ],
});
