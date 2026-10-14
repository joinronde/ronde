// What a form checks of a date field before it is sent, as a native date field would. Pure, for the tests

export type DateProblem = { kind: "required" } | { kind: "tooEarly"; bound: string } | { kind: "tooLate"; bound: string } | null;

/** ISO days ("2026-10-14") compare as text */
export function dateProblem(value: string, { required, min, max }: { required?: boolean; min?: string; max?: string }): DateProblem {
  if (!value) return required ? { kind: "required" } : null;
  if (min && value < min) return { kind: "tooEarly", bound: min };
  if (max && value > max) return { kind: "tooLate", bound: max };
  return null;
}
