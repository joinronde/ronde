import { agendaOf } from "@ronde/core/agenda";
import type { Meeting, Session } from "@ronde/db";
import { defineModule, defineOp, OpError, readConfig } from "@ronde/module-sdk";
import { z } from "zod";
import { requireActor, str } from "./shared";

// Planning poker: the team estimates items with cards kept hidden until the host reveals them

export const POKER_DECKS = {
  fibonacci: ["0", "1", "2", "3", "5", "8", "13", "21", "?", "☕"],
  tshirt: ["XS", "S", "M", "L", "XL", "?", "☕"],
  powers: ["1", "2", "4", "8", "16", "32", "?", "☕"],
} as const;
export type PokerDeck = keyof typeof POKER_DECKS;

const schema = z.object({ deck: z.enum(["fibonacci", "tshirt", "powers"]) });
export type PokerConfig = z.infer<typeof schema>;

/** The session is on a planning poker step of the agenda */
export function pokerLive(meeting: Pick<Meeting, "agenda">, session: Pick<Session, "stepKey"> | null): boolean {
  return !!session && agendaOf(meeting.agenda).some((b) => b.type === "poker" && b.id === session.stepKey);
}

export const poker = defineModule({
  id: "poker",
  category: "formats",
  feature: "modules.formats",
  defaultEnabled: false,
  icon: "🃏",
  config: { schema, defaults: { deck: "fibonacci" } },
  ops: [
    defineOp({
      name: "poker.item.add",
      permission: "session.run",
      session: "read",
      input: z.object({ title: str(200).min(1) }),
      run: async ({ db, requireSession, workspaceId }, o) => {
        const s = requireSession();
        const position = await db.pokerItem.count({ where: { sessionId: s.id } });
        if (position >= 50) throw new OpError("pokerTooManyItems");
        await db.pokerItem.create({ data: { workspaceId, sessionId: s.id, title: o.title, position } });
      },
    }),
    defineOp({
      name: "poker.item.remove",
      permission: "session.run",
      session: "read",
      input: z.object({ id: str(50) }),
      run: async ({ db, requireSession }, o) => {
        const { count } = await db.pokerItem.deleteMany({ where: { id: o.id, sessionId: requireSession().id } });
        if (!count) throw new OpError("notFound");
      },
    }),
    defineOp({
      name: "poker.vote",
      permission: "session.participate",
      session: "lock",
      input: z.object({ itemId: str(50), value: str(10) }),
      run: async ({ db, m, requireSession, workspaceId, module }, o) => {
        const s = requireSession();
        if (!pokerLive(m.meeting, s)) throw new OpError("pokerNotLive");
        const deck: readonly string[] = POKER_DECKS[readConfig(poker, module?.config).deck as PokerDeck];
        if (!deck.includes(o.value)) throw new OpError("pokerUnknownCard");
        const item = await db.pokerItem.findFirst({ where: { id: o.itemId, sessionId: s.id } });
        if (!item) throw new OpError("notFound");
        if (item.revealed || item.final !== null) throw new OpError("pokerRevealed");
        const personId = requireActor(m.viewer);
        await db.pokerVote.upsert({
          where: { itemId_personId: { itemId: item.id, personId } },
          create: { workspaceId, itemId: item.id, personId, value: o.value },
          update: { value: o.value },
        });
      },
    }),
    defineOp({
      name: "poker.reveal",
      permission: "session.run",
      session: "lock",
      input: z.object({ itemId: str(50) }),
      run: async ({ db, requireSession }, o) => {
        const { count } = await db.pokerItem.updateMany({
          where: { id: o.itemId, sessionId: requireSession().id },
          data: { revealed: true },
        });
        if (!count) throw new OpError("notFound");
      },
    }),
    defineOp({
      name: "poker.revote",
      permission: "session.run",
      session: "lock",
      input: z.object({ itemId: str(50) }),
      run: async ({ db, requireSession }, o) => {
        const item = await db.pokerItem.findFirst({ where: { id: o.itemId, sessionId: requireSession().id } });
        if (!item) throw new OpError("notFound");
        await db.pokerVote.deleteMany({ where: { itemId: item.id } });
        await db.pokerItem.update({ where: { id: item.id }, data: { revealed: false, final: null } });
      },
    }),
    defineOp({
      name: "poker.final",
      permission: "session.run",
      session: "lock",
      input: z.object({ itemId: str(50), value: str(10).nullable() }),
      run: async ({ db, requireSession }, o) => {
        const { count } = await db.pokerItem.updateMany({
          where: { id: o.itemId, sessionId: requireSession().id },
          data: { final: o.value, ...(o.value ? { revealed: true } : {}) },
        });
        if (!count) throw new OpError("notFound");
      },
    }),
    defineOp({
      name: "poker.configure",
      permission: "meeting.configure",
      input: schema,
      run: async ({ module }, o) => module!.setConfig(o),
    }),
  ],
});
