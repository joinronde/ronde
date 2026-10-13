import { describe, expect, it } from "vitest";
import { fold, matchesWords, searchWords } from "@/lib/shared/search";

// Searching as people type in the palettes and the meetings list: case and accents do not count

describe("folding a text", () => {
  it("drops case and the accents of Latin letters", () => {
    expect(fold("Élodie Lefèvre")).toBe("elodie lefevre");
    expect(fold("ÇA NÃO ÑANDÚ Über")).toBe("ca nao nandu uber");
    expect(fold("Zoé")).toBe(fold("ZOE"));
  });

  it("folds an accent written as its own combining mark like a precomposed one", () => {
    // "é" typed as e + U+0301 (some keyboards and pasted text) and as U+00E9
    expect(fold("école")).toBe(fold("école"));
    expect(fold("école")).toBe("ecole");
  });

  it("keeps letters that are not an accented form, such as ß, ø and ł", () => {
    expect(fold("Straße Søren Łukasz")).toBe("straße søren łukasz");
  });

  it("leaves Chinese and Hindi readable as they are", () => {
    expect(fold("周会 项目")).toBe("周会 项目");
    // Devanagari vowel signs are outside the Latin marks and stay
    expect(fold("साप्ताहिक बैठक")).toBe("साप्ताहिक बैठक".normalize("NFD"));
  });

  it("keeps Arabic letters and their vowel marks, in their right-to-left order", () => {
    expect(fold("اجتماع الفريق")).toBe("اجتماع الفريق");
    // Harakat (U+064B..U+0652) are not Latin accents: they are kept, so "مُدير" does not fold to "مدير"
    expect(fold("مُدير")).toBe("مُدير");
    expect(fold("مُدير")).not.toBe("مدير");
  });

  it("lowercases Cyrillic and Greek", () => {
    expect(fold("Встреча КОМАНДЫ")).toBe("встреча команды");
    expect(fold("ΟΜΆΔΑ")).toBe("ομαδα");
  });

  it("returns nothing for nothing", () => {
    expect(fold("")).toBe("");
  });
});

describe("the words of a query", () => {
  it("are none for a blank query, whatever the spaces", () => {
    expect(searchWords("")).toEqual([]);
    expect(searchWords("   \t\n ")).toEqual([]);
  });

  it("are split on any run of spaces, folded", () => {
    expect(searchWords("  Réunion   ÉQUIPE\tLundi ")).toEqual(["reunion", "equipe", "lundi"]);
  });

  it("split on a non-breaking space too", () => {
    expect(searchWords("plan produit")).toEqual(["plan", "produit"]);
  });
});

describe("matching a query", () => {
  it("matches everything when nothing is typed", () => {
    expect(matchesWords("Weekly sync", "")).toBe(true);
    expect(matchesWords("", "  ")).toBe(true);
  });

  it("finds a text whatever the case and accents typed", () => {
    expect(matchesWords("Comité de pilotage", "comite")).toBe(true);
    expect(matchesWords("comite de pilotage", "COMITÉ")).toBe(true);
  });

  it("needs every word typed, in any order", () => {
    expect(matchesWords("Product weekly · Meetings", "meet prod")).toBe(true);
    expect(matchesWords("Product weekly · Meetings", "meet design")).toBe(false);
  });

  it("finds a word inside another one", () => {
    expect(matchesWords("Standup", "and")).toBe(true);
  });

  it("is satisfied by one place for a word typed twice", () => {
    expect(matchesWords("Sprint review", "sprint sprint")).toBe(true);
  });

  it("finds Chinese and Arabic text by part of it", () => {
    expect(matchesWords("产品周会", "周会")).toBe(true);
    expect(matchesWords("اجتماع الفريق الأسبوعي", "الفريق")).toBe(true);
    expect(matchesWords("اجتماع الفريق", "الإدارة")).toBe(false);
  });

  it("treats characters special to regular expressions as plain text", () => {
    expect(matchesWords("Q&A (beta) [v2] *new*", "(beta) [v2] *new*")).toBe(true);
    expect(matchesWords("Budget 2026", ".*")).toBe(false);
  });

  it("finds nothing in an empty text once something is typed", () => {
    expect(matchesWords("", "a")).toBe(false);
  });
});
