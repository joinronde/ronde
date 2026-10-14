import { REACTION_BURST, REACTION_WINDOW_MS } from "@ronde/core/util";
import { describe, expect, it } from "vitest";
import { nudged, parseDuration, parseTime, reactionAllowance } from "@/lib/shared/pickers";

// The drawn time and duration fields read what people type the way they say it, and the live bar tells when
// reactions are back instead of dropping them silently

describe("parseTime", () => {
  it("reads a time however it is typed", () => {
    expect(parseTime("9:30")).toBe("09:30");
    expect(parseTime("09h30")).toBe("09:30");
    expect(parseTime("9h")).toBe("09:00");
    expect(parseTime("21 h")).toBe("21:00");
    expect(parseTime("930")).toBe("09:30");
    expect(parseTime("1015")).toBe("10:15");
    expect(parseTime("9.45")).toBe("09:45");
    expect(parseTime("7")).toBe("07:00");
  });
  it("reads the twelve-hour clock", () => {
    expect(parseTime("9:30 pm")).toBe("21:30");
    expect(parseTime("12 am")).toBe("00:00");
    expect(parseTime("12pm")).toBe("12:00");
    expect(parseTime("7a")).toBe("07:00");
  });
  it("refuses what is not a time", () => {
    for (const bad of ["", "24:00", "9:75", "13 pm", "0 am", "noon", "9:3"]) expect(parseTime(bad), bad).toBeNull();
  });
});

describe("parseDuration", () => {
  it("reads a meeting's length in minutes, hours or both", () => {
    expect(parseDuration("25", "minutes", 480)).toBe(25);
    expect(parseDuration("25 min", "minutes", 480)).toBe(25);
    expect(parseDuration("1h15", "minutes", 480)).toBe(75);
    expect(parseDuration("1 h 15", "minutes", 480)).toBe(75);
    expect(parseDuration("1:30", "minutes", 480)).toBe(90);
    expect(parseDuration("2h", "minutes", 480)).toBe(120);
    expect(parseDuration("1,5 h", "minutes", 480)).toBe(90);
  });
  it("reads a speaking time in minutes and seconds", () => {
    expect(parseDuration("2:30", "seconds", 1800)).toBe(150);
    expect(parseDuration("90 s", "seconds", 1800)).toBe(90);
    expect(parseDuration("2 min", "seconds", 1800)).toBe(120);
    expect(parseDuration("2m30", "seconds", 1800)).toBe(150);
    // A bare number is minutes while that fits, seconds beyond
    expect(parseDuration("2", "seconds", 1800)).toBe(120);
    expect(parseDuration("90", "seconds", 1800)).toBe(90);
  });
  it("has nothing to read without a number", () => {
    expect(parseDuration("", "minutes", 480)).toBeNull();
    expect(parseDuration("une heure", "minutes", 480)).toBeNull();
  });
});

describe("nudged", () => {
  it("lands − and + on the step's multiples", () => {
    expect(nudged(27, 5, 1)).toBe(30);
    expect(nudged(27, 5, -1)).toBe(25);
    expect(nudged(30, 5, 1)).toBe(35);
    expect(nudged(30, 5, -1)).toBe(25);
  });
});

describe("reactionAllowance", () => {
  const at = 1_000_000;
  it("lets reactions through until the burst, then says when the next one is allowed", () => {
    const sent = Array.from({ length: REACTION_BURST - 1 }, (_, i) => at - 1000 * (REACTION_BURST - 1 - i));
    expect(reactionAllowance(sent, at, REACTION_BURST, REACTION_WINDOW_MS).waitUntil).toBe(0);
    const full = [...sent, at];
    const { waitUntil } = reactionAllowance(full, at, REACTION_BURST, REACTION_WINDOW_MS);
    expect(waitUntil).toBe(full[0]! + REACTION_WINDOW_MS);
    expect(waitUntil).toBeGreaterThan(at);
  });
  it("forgets the reactions out of the window", () => {
    const old = Array.from({ length: REACTION_BURST }, () => at - REACTION_WINDOW_MS - 1);
    expect(reactionAllowance(old, at, REACTION_BURST, REACTION_WINDOW_MS)).toEqual({ recent: [], waitUntil: 0 });
  });
});

describe("passwordStrength", () => {
  it("grows with length, then with the mix of characters", async () => {
    const { passwordStrength } = await import("@/lib/shared/password");
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("short")).toBe(1);
    expect(passwordStrength("abcdefghij")).toBe(1);
    expect(passwordStrength("abcdefghijkl")).toBe(2);
    expect(passwordStrength("Abcdefghij1!")).toBe(3);
    expect(passwordStrength("abcdefghijklmnopq")).toBe(3);
    expect(passwordStrength("Abcdefghijklmnop1")).toBe(4);
  });
});
