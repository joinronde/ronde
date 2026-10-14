import { describe, expect, it } from "vitest";
import { singleFlight } from "@/lib/shared/single-flight";

// Two requests seeing the GitLab token expire renewed it each with the same refresh token: GitLab took the
// first and refused the second, whose person was told the connection failed

describe("one run at a time per key", () => {
  it("lets callers arriving meanwhile share the run, then starts a new one", async () => {
    const once = singleFlight<number>();
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = async () => {
      runs++;
      await gate;
      return runs;
    };
    const a = once("m1", run);
    const b = once("m1", run);
    const other = once("m2", async () => 99);
    release();
    expect(await Promise.all([a, b, other])).toEqual([1, 1, 99]);
    expect(runs).toBe(1);
    expect(await once("m1", async () => 7)).toBe(7);
  });

  it("lets a failed run go, so the next caller tries again", async () => {
    const once = singleFlight<number>();
    await expect(once("k", async () => Promise.reject(new Error("refused")))).rejects.toThrow("refused");
    expect(await once("k", async () => 2)).toBe(2);
  });
});
