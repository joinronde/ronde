import { agendaOf, type RetroPhase, retroPhaseOf } from "@ronde/core/agenda";
import type { Meeting, ScopedTx, Session } from "@ronde/db";
import { type Locale, translator } from "@ronde/i18n";
import { AccessError, defineModule, defineOp, OpError, readConfig } from "@ronde/module-sdk";
import { z } from "zod";
import { requireActor, str } from "./shared";

// Retrospective: everyone writes anonymous sticky notes in columns, the host groups them, the team votes,
// then discusses the most voted groups. A meeting gets one by adding a "retro" block to its agenda.

export const RETRO_PRESETS = {
  "well-improve-ideas": ["well", "improve", "ideas"],
  "start-stop-continue": ["start", "stop", "continue"],
  "4l": ["liked", "learned", "lacked", "longed"],
  "mad-sad-glad": ["mad", "sad", "glad"],
} as const;
export type RetroPreset = keyof typeof RETRO_PRESETS;

const schema = z.object({
  preset: z.enum(["well-improve-ideas", "start-stop-continue", "4l", "mad-sad-glad", "custom"]),
  /** Columns of the "custom" preset */
  columns: z.array(z.object({ key: z.string().regex(/^[a-z0-9]{1,20}$/), label: z.string().trim().min(1).max(40) })).max(6),
  votesPerPerson: z.number().int().min(1).max(10),
  reflectMinutes: z.number().int().min(1).max(30),
  voteMinutes: z.number().int().min(1).max(15),
  discussMinutes: z.number().int().min(1).max(30),
});
export type RetroConfig = z.infer<typeof schema>;

const defaults: RetroConfig = {
  preset: "well-improve-ideas",
  columns: [],
  votesPerPerson: 3,
  reflectMinutes: 7,
  voteMinutes: 3,
  discussMinutes: 5,
};

/** Columns of a retro, labels in a language */
export function retroColumns(config: RetroConfig, locale: Locale): { key: string; label: string; color: number }[] {
  if (config.preset === "custom" && config.columns.length) return config.columns.map((c, i) => ({ ...c, color: i % 6 }));
  const t = translator(locale, "retro");
  const preset = config.preset === "custom" ? "well-improve-ideas" : config.preset;
  return RETRO_PRESETS[preset].map((key, i) => ({ key, label: t(`columns.${key}` as "columns.well"), color: i % 6 }));
}

/** Retro block of the meeting's agenda, and the phase the session is in (null outside the retro) */
export function retroState(
  meeting: Pick<Meeting, "agenda">,
  session: Pick<Session, "stepKey"> | null,
): { blockId: string | null; phase: RetroPhase | null } {
  const block = agendaOf(meeting.agenda).find((b) => b.type === "retro");
  if (!block || !session) return { blockId: block?.id ?? null, phase: null };
  const prefix = `${block.id}:`;
  return { blockId: block.id, phase: session.stepKey.startsWith(prefix) ? retroPhaseOf(session.stepKey.slice(prefix.length)) : null };
}

const requirePhase = (ctx: { m: { meeting: Meeting }; requireSession: () => Session }, phase: RetroPhase) => {
  const s = ctx.requireSession();
  if (retroState(ctx.m.meeting, s).phase !== phase) throw new OpError("retroWrongPhase");
  return s;
};

/** Groups left without any sticky note are removed */
async function dropEmptyGroups(db: ScopedTx, sessionId: string) {
  await db.retroGroup.deleteMany({ where: { sessionId, cards: { none: {} } } });
}

/** Entering the vote: every note left alone becomes a group of its own, so it can be voted on */
export async function groupLoneCards(db: ScopedTx, workspaceId: string, sessionId: string) {
  const alone = await db.retroCard.findMany({ where: { sessionId, groupId: null }, orderBy: { createdAt: "asc" } });
  let position = await db.retroGroup.count({ where: { sessionId } });
  for (const card of alone) {
    const g = await db.retroGroup.create({ data: { workspaceId, sessionId, column: card.column, position: position++ } });
    await db.retroCard.update({ where: { id: card.id }, data: { groupId: g.id } });
  }
}

export const retro = defineModule({
  id: "retro",
  category: "formats",
  feature: "modules.formats",
  defaultEnabled: false,
  icon: "🔍",
  config: { schema, defaults },
  ops: [
    defineOp({
      name: "retro.card.add",
      permission: "session.participate",
      session: "read",
      input: z.object({ column: str(20), text: str(500).min(1) }),
      run: async (ctx, o) => {
        const s = requirePhase(ctx, "reflect");
        const config = readConfig(retro, ctx.module?.config);
        if (!retroColumns(config, "en").some((c) => c.key === o.column)) throw new OpError("notFound");
        const authorId = requireActor(ctx.m.viewer);
        if ((await ctx.db.retroCard.count({ where: { sessionId: s.id, authorId } })) >= 60) throw new OpError("retroTooManyCards");
        await ctx.db.retroCard.create({
          data: { workspaceId: ctx.workspaceId, sessionId: s.id, column: o.column, authorId, text: o.text },
        });
      },
    }),
    defineOp({
      name: "retro.card.update",
      permission: "session.participate",
      session: "read",
      input: z.object({ id: str(50), text: str(500).min(1) }),
      run: async (ctx, o) => {
        const s = requirePhase(ctx, "reflect");
        const { count } = await ctx.db.retroCard.updateMany({
          where: { id: o.id, sessionId: s.id, authorId: requireActor(ctx.m.viewer) },
          data: { text: o.text },
        });
        if (!count) throw new AccessError(403, "retroOwnCardsOnly");
      },
    }),
    defineOp({
      name: "retro.card.delete",
      permission: "session.participate",
      session: "read",
      input: z.object({ id: str(50) }),
      run: async (ctx, o) => {
        const s = requirePhase(ctx, "reflect");
        const { count } = await ctx.db.retroCard.deleteMany({ where: { id: o.id, sessionId: s.id, authorId: requireActor(ctx.m.viewer) } });
        if (!count) throw new AccessError(403, "retroOwnCardsOnly");
      },
    }),
    defineOp({
      name: "retro.group",
      permission: "session.run",
      session: "lock",
      input: z.object({ cardId: str(50), targetCardId: str(50) }),
      run: async (ctx, o) => {
        const s = requirePhase(ctx, "group");
        if (o.cardId === o.targetCardId) return;
        const [card, target] = await Promise.all([
          ctx.db.retroCard.findFirst({ where: { id: o.cardId, sessionId: s.id } }),
          ctx.db.retroCard.findFirst({ where: { id: o.targetCardId, sessionId: s.id } }),
        ]);
        if (!card || !target) throw new OpError("notFound");
        let groupId = target.groupId;
        if (!groupId) {
          const position = await ctx.db.retroGroup.count({ where: { sessionId: s.id } });
          groupId = (
            await ctx.db.retroGroup.create({ data: { workspaceId: ctx.workspaceId, sessionId: s.id, column: target.column, position } })
          ).id;
          await ctx.db.retroCard.update({ where: { id: target.id }, data: { groupId } });
        }
        await ctx.db.retroCard.update({ where: { id: card.id }, data: { groupId } });
        await dropEmptyGroups(ctx.db, s.id);
      },
    }),
    defineOp({
      name: "retro.ungroup",
      permission: "session.run",
      session: "lock",
      input: z.object({ cardId: str(50) }),
      run: async (ctx, o) => {
        const s = requirePhase(ctx, "group");
        const { count } = await ctx.db.retroCard.updateMany({ where: { id: o.cardId, sessionId: s.id }, data: { groupId: null } });
        if (!count) throw new OpError("notFound");
        await dropEmptyGroups(ctx.db, s.id);
      },
    }),
    defineOp({
      name: "retro.group.rename",
      permission: "session.run",
      session: "read",
      input: z.object({ id: str(50), title: str(120) }),
      run: async (ctx, o) => {
        const s = ctx.requireSession();
        const { count } = await ctx.db.retroGroup.updateMany({ where: { id: o.id, sessionId: s.id }, data: { title: o.title } });
        if (!count) throw new OpError("notFound");
      },
    }),
    defineOp({
      name: "retro.vote",
      permission: "session.participate",
      session: "lock",
      input: z.object({ groupId: str(50) }),
      run: async (ctx, o) => {
        const s = requirePhase(ctx, "vote");
        const personId = requireActor(ctx.m.viewer);
        const group = await ctx.db.retroGroup.findFirst({ where: { id: o.groupId, sessionId: s.id }, select: { id: true } });
        if (!group) throw new OpError("notFound");
        const key = { groupId_personId: { groupId: group.id, personId } };
        if (await ctx.db.retroVote.findUnique({ where: key })) {
          await ctx.db.retroVote.delete({ where: key });
          return;
        }
        const limit = readConfig(retro, ctx.module?.config).votesPerPerson;
        const used = await ctx.db.retroVote.count({ where: { personId, group: { sessionId: s.id } } });
        if (used >= limit) throw new OpError("votesUsed", { count: limit });
        await ctx.db.retroVote.create({ data: { workspaceId: ctx.workspaceId, groupId: group.id, personId } });
      },
    }),
    defineOp({
      name: "retro.configure",
      permission: "meeting.configure",
      input: schema,
      run: async ({ module }, o) => {
        if (o.preset === "custom" && !o.columns.length) throw new OpError("retroNoColumns");
        await module!.setConfig(o);
      },
    }),
  ],
});

/** A timebox: a topic of its own on the agenda, with its own duration (set on the block) */
export const timebox = defineModule({
  id: "timebox",
  category: "organisation",
  feature: "modules.facilitation",
  defaultEnabled: true,
  icon: "⏳",
  config: { schema: z.object({}), defaults: {} },
  ops: [],
});
