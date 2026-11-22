// A recurring check that talks to an outside service (a mailbox…) and may fail for a moment: a network cut, a
// timeout. After a failure the next runs are skipped for a while, longer at each failure in a row (1, 2, 4… minutes,
// up to a cap), and only a failure that lasts is worth an error report: the one that reaches `reportAfter` in a row.

export interface Backoff {
  /** Whether this run may try (false while waiting after a failure) */
  ready: (now?: number) => boolean;
  /** A run that worked: back to trying every time */
  succeeded: () => void;
  /** A run that failed; `report` is true once, when the failures in a row reach `reportAfter` */
  failed: (now?: number) => { failures: number; retryInMs: number; report: boolean };
}

export function backoff(options: { baseMs?: number; maxMs?: number; reportAfter?: number } = {}): Backoff {
  const base = options.baseMs ?? 60_000;
  const max = options.maxMs ?? 15 * 60_000;
  const reportAfter = options.reportAfter ?? 5;
  let failures = 0;
  let nextAt = 0;
  return {
    ready: (now = Date.now()) => now >= nextAt,
    succeeded: () => {
      failures = 0;
      nextAt = 0;
    },
    failed: (now = Date.now()) => {
      failures++;
      const retryInMs = Math.min(max, base * 2 ** (failures - 1));
      nextAt = now + retryInMs;
      return { failures, retryInMs, report: failures === reportAfter };
    },
  };
}
