import { describe, expect, it } from "vitest";
import { choiceMatches, foldText, matchRanges, searchChoices } from "@/lib/shared/select-search";

// Long lists (time zones, countries, regions) are searched by typing: they used to be scrolled through

const zones = ["Europe/London", "Europe/Paris", "America/New_York", "America/Sao_Paulo", "Asia/Ho_Chi_Minh"].map((z) => ({
  value: z,
  text: z,
}));

describe("searching a long list", () => {
  it("reads time zones and accents as plain words", () => {
    expect(foldText("America/Sao_Paulo")).toBe("america sao paulo");
    expect(foldText("Île-de-France")).toBe("ile de france");
  });

  it("finds a choice by the start of any of its words", () => {
    expect(searchChoices(zones, "paris").map((i) => zones[i]!.value)).toEqual(["Europe/Paris"]);
    expect(searchChoices(zones, "new york").map((i) => zones[i]!.value)).toEqual(["America/New_York"]);
    expect(searchChoices(zones, "são").map((i) => zones[i]!.value)).toEqual(["America/Sao_Paulo"]);
    expect(searchChoices(zones, "ork")).toEqual([]);
    expect(searchChoices(zones, "")).toHaveLength(zones.length);
  });

  it("puts the labels starting with what was typed first", () => {
    const countries = [
      { value: "BE", text: "Belgique" },
      { value: "FR", text: "France" },
      { value: "GF", text: "Guyane française" },
    ];
    expect(searchChoices(countries, "fra").map((i) => countries[i]!.value)).toEqual(["FR", "GF"]);
    // The value counts too (a country code)
    expect(choiceMatches({ value: "DE", text: "Allemagne" }, "de")).toBe(true);
    // And the group of the choice
    expect(choiceMatches({ value: "x", text: "Paris", group: "Europe" }, "europe")).toBe(true);
  });

  it("highlights where each word typed matches, in the label as written", () => {
    const cut = (text: string, query: string) => matchRanges(text, query).map(([a, b]) => text.slice(a, b));
    expect(cut("America/New_York", "new y")).toEqual(["New", "Y"]);
    expect(cut("Île-de-France", "ile fra")).toEqual(["Île", "Fra"]);
    expect(cut("São Paulo", "sao")).toEqual(["São"]);
    // Only at the start of a word, and once
    expect(cut("Banana", "ana")).toEqual([]);
    expect(cut("Paris Paris", "par")).toEqual(["Par"]);
    // Words that overlap make one highlight
    expect(cut("Newcastle", "new newc")).toEqual(["Newc"]);
    expect(matchRanges("Paris", "")).toEqual([]);
    // The searches matching inside words highlight there too
    expect(matchRanges("Martin", "art", { anywhere: true }).map(([x, y]) => "Martin".slice(x, y))).toEqual(["art"]);
  });
});
