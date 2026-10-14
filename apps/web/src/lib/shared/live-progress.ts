// Where a session going on stands, for the people not in it yet: the step it is at, who has had their turn,
// who is speaking. Worked out from the agenda's blocks, the speaking order and the current step. Pure, for
// the server-free tests

export interface LiveProgress {
  /** What the step is: the introduction, someone's turn, the project round, the open topics, the wrap-up, a block */
  step: "intro" | "turn" | "projects" | "topics" | "end" | "block";
  /** Title of a block step (a timebox), when it has one */
  title: string;
  /** Who is speaking, on a turn */
  speaking: string | null;
  /** Who has had their turn already */
  spoke: string[];
  /** Everyone with a turn this session, in order */
  turns: string[];
}

interface Block {
  id: string;
  type: string;
  title?: string;
}

const BLOCK_OF_KEY: Record<string, string> = { intro: "intro", misc: "topics" };

/**
 * `turns`: the speaking order without the absent. The step of a project (`p:<id>`), a retrospective or a timebox
 * (keys starting with their block's id) and the questions after a step (`qa:<key>`) all place it in the agenda.
 */
export function liveProgress(blocks: readonly Block[], turns: readonly string[], stepKey: string): LiveProgress {
  const key = stepKey.startsWith("qa:") ? stepKey.slice(3) : stepKey;
  const round = blocks.findIndex((b) => b.type === "round");
  const turn = turns.indexOf(key);
  if (turn >= 0) return { step: "turn", title: "", speaking: key, spoke: turns.slice(0, turn), turns: [...turns] };
  if (key === "end") return { step: "end", title: "", speaking: null, spoke: [...turns], turns: [...turns] };
  const at = blocks.findIndex((b) =>
    BLOCK_OF_KEY[key]
      ? b.type === BLOCK_OF_KEY[key]
      : key.startsWith("p:")
        ? b.type === "projects"
        : key === b.id || key.startsWith(`${b.id}:`),
  );
  const block = blocks[at];
  const step: LiveProgress["step"] =
    block?.type === "intro" ? "intro" : block?.type === "projects" ? "projects" : block?.type === "topics" ? "topics" : "block";
  // Past the round table once a block after it is reached
  const after = at >= 0 && round >= 0 && at > round;
  return { step, title: block?.title ?? "", speaking: null, spoke: after ? [...turns] : [], turns: [...turns] };
}

/** How many turns come before the person's: 0 when they speak now, null when they have spoken or have no turn */
export function turnsBefore(p: Pick<LiveProgress, "turns" | "spoke" | "speaking">, personId: string): number | null {
  if (p.spoke.includes(personId)) return null;
  const mine = p.turns.indexOf(personId);
  if (mine < 0) return null;
  const now = p.speaking ? p.turns.indexOf(p.speaking) : p.spoke.length;
  return Math.max(0, mine - now);
}

/**
 * The round table of a session going on: the people with a turn in their order (the others after), each done,
 * speaking or waiting; the arc over the turns done, halfway into the one going on
 */
export function liveSeats<P extends { id: string }>(people: P[], p: Pick<LiveProgress, "turns" | "spoke" | "speaking">, max = 8) {
  const rank = (id: string) => {
    const i = p.turns.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const spoke = new Set(p.spoke);
  const seats = [...people]
    .sort((a, b) => rank(a.id) - rank(b.id))
    .slice(0, max)
    .map((x) => ({
      ...x,
      state: spoke.has(x.id) ? ("done" as const) : x.id === p.speaking ? ("speaking" as const) : ("waiting" as const),
    }));
  const done = seats.filter((x) => x.state === "done").length + (seats.some((x) => x.state === "speaking") ? 0.5 : 0);
  return { seats, more: people.length - seats.length, share: seats.length ? Math.min(1, done / seats.length) : 0 };
}
