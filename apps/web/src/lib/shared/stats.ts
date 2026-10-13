import { type CsvCell, round2 } from "@ronde/core/csv";
import type { SessionStats, StatsDTO } from "@ronde/core/stats";

// What the meeting's statistics page computes from the archived sessions: the chart scale, the figures at
// the top and the spreadsheet export. Pure, so the server-free tests check them

/** A round step for a chart's axis, so four steps reach `v`: 1, 2, 5, 10, 20, 25, 50... then a quarter of it */
export function niceStep(v: number) {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) if (s * 4 >= v) return s;
  return Math.ceil(v / 4);
}

/** The columns of the export after the date, in order (each titled from the `csv` messages) */
export const CSV_COLUMNS = [
  "durationMin",
  "present",
  "absent",
  "planned",
  "done",
  "blockers",
  "questions",
  "hands",
  "kudos",
  "mood",
  "rating",
] as const;

/** Sessions for a spreadsheet: a header line, then one line per archived session (escaping is the CSV writer's) */
export const sessionsCsv = (st: Pick<StatsDTO, "sessions">, head: string[]): CsvCell[][] => [
  head,
  ...st.sessions.map((x) => [
    x.date,
    Math.round(x.durationMs / 6000) / 10,
    x.present,
    x.absent,
    x.planned,
    x.done,
    x.blockers,
    x.questions,
    x.hands,
    x.kudos,
    round2(x.mood),
    round2(x.rating),
  ]),
];

/** Share of the people expected who came; a session that expected nobody counts as full */
export const presence = (h: Pick<SessionStats, "present" | "absent">) => (h.present + h.absent ? h.present / (h.present + h.absent) : 1);

/** The figures at the top of the statistics, over sessions oldest first */
export function statsKpis(st: Pick<StatsDTO, "sessions" | "speaking">) {
  const H = st.sessions;
  // The page shows these only once a session is archived; none gives no average rather than NaN
  const avgDur = H.length ? H.reduce((a, h) => a + h.durationMs, 0) / H.length : 0;
  // Speaking time per turn over everyone, not the mean of each person's mean
  const turns = st.speaking.reduce((a, p) => a + p.turns, 0);
  const avgS = turns ? st.speaking.reduce((a, p) => a + p.avgMs * p.turns, 0) / turns : 0;
  // Planned → done: the first session has no previous one to have planned anything
  const pdKnown = H.slice(1).filter((x) => x.planned > 0);
  const pdTotal = pdKnown.reduce((a, x) => a + x.planned, 0);
  const pdRate = pdTotal ? pdKnown.reduce((a, x) => a + x.done, 0) / pdTotal : null;
  const avgPres = H.length ? H.reduce((a, h) => a + presence(h), 0) / H.length : 1;
  // Usefulness over every rating given, not the mean of the meetings' means
  const ratingVotes = H.reduce((a, h) => a + (h.rating != null ? h.ratingVotes : 0), 0);
  const ratingAvg = ratingVotes ? H.reduce((a, h) => a + (h.rating != null ? h.rating * h.ratingVotes : 0), 0) / ratingVotes : null;
  return { avgDur, avgS, pdKnown, pdTotal, pdRate, avgPres, ratingVotes, ratingAvg };
}
