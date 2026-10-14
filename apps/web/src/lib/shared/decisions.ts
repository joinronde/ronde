// The decisions page: by period and meeting, grouped by month. Pure, so the server-free tests check them

export const DECISION_PERIODS = ["all", "30", "90", "year"] as const;
export type DecisionPeriod = (typeof DECISION_PERIODS)[number];

/** First day a period keeps ("2026-09-13" for 30 days before 2026-10-13); null: every date */
export function periodStart(period: DecisionPeriod, today: string): string | null {
  if (period === "all") return null;
  if (period === "year") return `${today.slice(0, 4)}-01-01`;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - Number(period));
  return d.toISOString().slice(0, 10);
}

/** Decisions of a meeting (or all) and of a period, newest first, by month */
export function decisionMonths<D extends { date: string; meetingId: string }>(
  decisions: D[],
  meetingId: string | null,
  period: DecisionPeriod,
  today: string,
): { key: string; items: D[] }[] {
  const from = periodStart(period, today);
  const months: { key: string; items: D[] }[] = [];
  for (const d of [...decisions].sort((a, b) => b.date.localeCompare(a.date))) {
    if ((meetingId && d.meetingId !== meetingId) || (from && d.date < from)) continue;
    const key = d.date.slice(0, 7);
    const last = months[months.length - 1];
    if (last?.key === key) last.items.push(d);
    else months.push({ key, items: [d] });
  }
  return months;
}
