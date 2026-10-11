import type { DrawDTO, DrawKind } from "@ronde/core/types";
import { Prisma, type Session } from "@ronde/db";
import { defineModule, defineOp, OpError } from "@ronde/module-sdk";
import { createRandomSeed, createSeededRandom } from "@ronde/random-core";
import { z } from "zod";
import { none } from "./shared";

// Random tools: a wheel to pick who goes next, a random speaking order, teams, heads or tails.
// The server draws the seed and the outcome; every screen replays the same animation from the seed.

export const DRAW_KINDS = ["wheel", "order", "teams", "coin"] as const satisfies readonly DrawKind[];

/** Outcome of a draw from its seed (pure: the same seed always gives the same outcome) */
export function drawOutcome(
  kind: DrawKind,
  entries: string[],
  seed: string,
  teamSize = 2,
): Pick<DrawDTO, "pick" | "tails" | "order" | "teams"> {
  const rng = createSeededRandom(seed);
  const out: Pick<DrawDTO, "pick" | "tails" | "order" | "teams"> = { pick: null, tails: null, order: [], teams: [] };
  if (kind === "wheel") out.pick = entries[rng.nextInt(entries.length)] ?? null;
  else if (kind === "coin") out.tails = rng.nextInt(2) === 1;
  else if (kind === "order") out.order = rng.shuffle(entries);
  else {
    // As many teams as needed for the size, then dealt in turn: sizes differ by one at most
    const count = Math.max(1, Math.round(entries.length / teamSize));
    out.teams = Array.from({ length: count }, () => [] as string[]);
    rng.shuffle(entries).forEach((id, i) => out.teams[i % count]!.push(id));
  }
  return out;
}

/** Stored draw of a session, or null */
export function readDraw(v: unknown): DrawDTO | null {
  const o = (v && typeof v === "object" ? v : {}) as Partial<DrawDTO>;
  if (!o.kind || !DRAW_KINDS.includes(o.kind) || typeof o.seed !== "string") return null;
  return {
    id: String(o.id ?? o.seed),
    kind: o.kind,
    seed: o.seed,
    at: Number(o.at) || 0,
    entries: Array.isArray(o.entries) ? o.entries.map(String) : [],
    pick: typeof o.pick === "string" ? o.pick : null,
    tails: typeof o.tails === "boolean" ? o.tails : null,
    order: Array.isArray(o.order) ? o.order.map(String) : [],
    teams: Array.isArray(o.teams) ? o.teams.map((t) => (Array.isArray(t) ? t.map(String) : [])) : [],
    applied: o.applied === true,
  };
}

/** People still to speak in the round (not absent, not on or past their turn); everyone present once the round is over */
function drawEntries(s: Pick<Session, "order" | "absent" | "stepKey" | "spent">, everyone: boolean): string[] {
  const present = s.order.filter((id) => !s.absent.includes(id));
  if (everyone) return present;
  const spent = (s.spent && typeof s.spent === "object" ? s.spent : {}) as Record<string, number>;
  const waiting = present.filter((id) => id !== s.stepKey && !(Number(spent[id]) > 0));
  return waiting.length ? waiting : present;
}

export const random = defineModule({
  id: "random",
  category: "facilitation",
  feature: "modules.facilitation",
  defaultEnabled: false,
  icon: "🎡",
  config: { schema: none, defaults: {} },
  ops: [
    defineOp({
      name: "random.draw",
      permission: "session.run",
      session: "lock",
      input: z.object({ kind: z.enum(DRAW_KINDS), teamSize: z.number().int().min(2).max(10).default(2) }),
      run: async ({ db, requireSession }, o) => {
        const s = requireSession();
        const entries = o.kind === "coin" ? [] : drawEntries(s, o.kind === "teams");
        if (o.kind !== "coin" && entries.length < 2) throw new OpError("drawNeedsPeople");
        const seed = createRandomSeed();
        const draw: DrawDTO = {
          id: seed.slice(0, 12),
          kind: o.kind,
          seed,
          at: Date.now(),
          entries,
          applied: false,
          ...drawOutcome(o.kind, entries, seed, o.teamSize),
        };
        await db.session.update({ where: { id: s.id }, data: { draw: draw as unknown as Prisma.InputJsonObject } });
      },
    }),
    defineOp({
      name: "random.apply",
      permission: "session.run",
      session: "lock",
      input: none,
      run: async ({ db, requireSession }) => {
        const s = requireSession();
        const draw = readDraw(s.draw);
        if (!draw || (draw.kind !== "wheel" && draw.kind !== "order")) throw new OpError("notFound");
        // The drawn people take the next turns, in the drawn order; who already spoke and who is absent keep their place
        const drawn = draw.kind === "order" ? draw.order : [draw.pick!, ...draw.entries.filter((id) => id !== draw.pick)];
        const kept = s.order.filter((id) => !drawn.includes(id));
        const order = [
          ...kept.filter((id) => !s.absent.includes(id)),
          ...drawn.filter((id) => s.order.includes(id)),
          ...kept.filter((id) => s.absent.includes(id)),
        ];
        await db.session.update({
          where: { id: s.id },
          data: { order, draw: { ...draw, applied: true } as unknown as Prisma.InputJsonObject },
        });
      },
    }),
    defineOp({
      name: "random.clear",
      permission: "session.run",
      session: "lock",
      input: none,
      run: async ({ db, requireSession }) => {
        await db.session.update({ where: { id: requireSession().id }, data: { draw: Prisma.DbNull } });
      },
    }),
  ],
});
