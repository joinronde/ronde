// Periods people are away: who is away on a given day, and until when

export interface AbsencePeriod {
  personId: string;
  /** First and last day away, YYYY-MM-DD (inclusive) */
  from: string;
  to: string;
  delegateId?: string | null;
}

/** Whether the period covers a day */
export const covers = (a: Pick<AbsencePeriod, "from" | "to">, date: string) => a.from <= date && date <= a.to;

/** People away on a day */
export const awayOn = (absences: AbsencePeriod[], date: string): Set<string> =>
  new Set(absences.filter((a) => covers(a, date)).map((a) => a.personId));

/** Last day of the absence that covers a day, for "back on…" (absences that follow each other are joined) */
export function awayUntil(absences: AbsencePeriod[], personId: string, date: string): string | null {
  const theirs = absences.filter((a) => a.personId === personId).sort((a, b) => a.from.localeCompare(b.from));
  let until: string | null = null;
  let day = date;
  for (const a of theirs) {
    if (covers(a, day)) {
      until = a.to;
      day = nextDay(a.to);
    }
  }
  return until;
}

export const nextDay = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Checks a period entered by hand: dates in order, not longer than a year */
export function validPeriod(from: string, to: string): boolean {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(from) || !iso.test(to) || to < from) return false;
  return Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) <= 366 * 86_400_000;
}
