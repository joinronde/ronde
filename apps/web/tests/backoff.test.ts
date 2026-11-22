import { describe, expect, it } from "vitest";
import { backoff } from "@/lib/server/backoff";

// A recurring check against an outside service (the replies' mailbox): a failure now and then waits for a later run
// and is not reported; one that lasts is reported once

const MIN = 60_000;

describe("a recurring check that fails", () => {
  it("tries every time while it works", () => {
    const b = backoff();
    expect(b.ready(0)).toBe(true);
    b.succeeded();
    expect(b.ready(1)).toBe(true);
  });

  it("waits longer after each failure in a row, up to a cap", () => {
    const b = backoff({ baseMs: MIN, maxMs: 15 * MIN, reportAfter: 99 });
    const waits = [1, 2, 3, 4, 5, 6].map(() => b.failed(0).retryInMs / MIN);
    expect(waits).toEqual([1, 2, 4, 8, 15, 15]);
  });

  it("skips the runs until the wait is over", () => {
    const b = backoff({ baseMs: MIN });
    b.failed(0);
    b.failed(0);
    expect(b.ready(MIN)).toBe(false);
    expect(b.ready(2 * MIN - 1)).toBe(false);
    expect(b.ready(2 * MIN)).toBe(true);
  });

  it("reports only a lasting failure, once", () => {
    const b = backoff({ reportAfter: 3 });
    expect([1, 2, 3, 4, 5].map(() => b.failed(0).report)).toEqual([false, false, true, false, false]);
  });

  it("starts over after a success: an isolated timeout is never reported", () => {
    const b = backoff({ baseMs: MIN, reportAfter: 2 });
    expect(b.failed(0)).toEqual({ failures: 1, retryInMs: MIN, report: false });
    b.succeeded();
    expect(b.ready(0)).toBe(true);
    expect(b.failed(0)).toEqual({ failures: 1, retryInMs: MIN, report: false });
    expect(b.failed(0).report).toBe(true);
  });
});
