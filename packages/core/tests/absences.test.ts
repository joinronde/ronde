import { describe, expect, it } from "vitest";
import { awayOn, awayUntil, covers, validPeriod } from "../src/absences";

const a = (personId: string, from: string, to: string) => ({ personId, from, to });

describe("absences", () => {
  it("covers both ends of the period", () => {
    expect(covers(a("p", "2026-10-10", "2026-10-12"), "2026-10-10")).toBe(true);
    expect(covers(a("p", "2026-10-10", "2026-10-12"), "2026-10-12")).toBe(true);
    expect(covers(a("p", "2026-10-10", "2026-10-12"), "2026-10-13")).toBe(false);
  });
  it("lists who is away on a day", () => {
    expect([...awayOn([a("emma", "2026-10-01", "2026-10-31"), a("hugo", "2026-11-01", "2026-11-02")], "2026-10-15")]).toEqual(["emma"]);
  });
  it("joins periods that follow each other for the return date", () => {
    const list = [a("emma", "2026-10-05", "2026-10-09"), a("emma", "2026-10-10", "2026-10-18"), a("emma", "2026-12-01", "2026-12-02")];
    expect(awayUntil(list, "emma", "2026-10-06")).toBe("2026-10-18");
    expect(awayUntil(list, "emma", "2026-10-20")).toBeNull();
  });
  it("refuses periods backwards or longer than a year", () => {
    expect(validPeriod("2026-10-10", "2026-10-09")).toBe(false);
    expect(validPeriod("2026-01-01", "2027-06-01")).toBe(false);
    expect(validPeriod("2026-10-10", "2026-10-10")).toBe(true);
  });
});
