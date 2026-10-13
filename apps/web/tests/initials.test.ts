import { initials as liveInitials } from "@ronde/core/util";
import { describe, expect, it } from "vitest";
import { initials, meetingInitials } from "@/lib/shared/initials";

// The letters shown where there is no picture: a person's or a project's face, a meeting's mark, the live views.
// Three ways on purpose (see lib/shared/initials.ts), each checked on the names people really have

describe("a person's or a project's initials", () => {
  it("take the first and the last word", () => {
    expect(initials("Camille Martin")).toBe("CM");
    expect(initials("Ana María López García")).toBe("AG");
  });

  it("are one letter for a single name", () => {
    expect(initials("Camille")).toBe("C");
  });

  it("ignore extra spaces, tabs and line breaks", () => {
    expect(initials("   Jean \t  Dupont \n")).toBe("JD");
  });

  it("are capitals, accents kept", () => {
    expect(initials("élodie durand")).toBe("ÉD");
  });

  it("skip words that start with neither a letter nor a digit", () => {
    expect(initials("Product team (demo)")).toBe("PT");
    expect(initials("🚀 Launch")).toBe("L");
    expect(initials("Party 🎉")).toBe("P");
    expect(initials("3D printing")).toBe("3P");
  });

  it("read Arabic and Chinese names", () => {
    expect(initials("ليلى حداد")).toBe("لح");
    expect(initials("李伟")).toBe("李");
    expect(initials("王 小明")).toBe("王小");
  });

  it("keep a character written with two UTF-16 units whole", () => {
    // A rare Chinese character (CJK extension B) and a mathematical letter
    expect(initials("𠀀 Li")).toBe("𠀀L");
    expect(initials("Ann 𝒜lpha")).toBe("A𝒜");
  });

  it("are a question mark when nothing is left", () => {
    for (const name of ["", "   ", "(demo)", "🎉 🎈", "- -"]) expect(initials(name)).toBe("?");
  });

  it("stay two letters for a very long name", () => {
    expect(initials(Array.from({ length: 50 }, (_, i) => `W${i}`).join(" "))).toBe("WW");
  });
});

describe("a meeting's initials", () => {
  it("take every word, for the mark to cut to its size", () => {
    expect(meetingInitials("Daily standup")).toBe("DS");
    expect(meetingInitials("Weekly product team sync")).toBe("WPTS");
    expect(meetingInitials("Retro")).toBe("R");
  });

  it("ignore extra spaces", () => {
    expect(meetingInitials("  Weekly   sync  ")).toBe("WS");
  });

  it("keep an emoji whole, and the first character of any word", () => {
    expect(meetingInitials("🚀 Launch review")).toBe("🚀LR");
    // Cut to the room of the mark by characters as seen, never half of one
    expect(meetingInitials("🚀 Launch review", 1)).toBe("🚀");
    expect(meetingInitials("सुबह बैठक", 2)).toBe("सुबै");
    expect(meetingInitials("Product team (demo)")).toBe("PT(");
  });

  it("read accents, Arabic and Chinese", () => {
    expect(meetingInitials("équipe produit")).toBe("ÉP");
    expect(meetingInitials("اجتماع الفريق")).toBe("اا");
    expect(meetingInitials("周会")).toBe("周");
  });

  it("are empty for an empty name", () => {
    expect(meetingInitials("")).toBe("");
    expect(meetingInitials("   ")).toBe("");
  });

  // A flag is two code points, a family emoji several joined ones: kept whole, not a lone letter in a box
  it("keep a flag or a joined emoji whole", () => {
    expect(meetingInitials("🇫🇷 Team")).toBe("🇫🇷T");
    expect(meetingInitials("👨‍👩‍👧 Family")).toBe("👨‍👩‍👧F");
  });
});

describe("initials in the live views", () => {
  it("take the first two words, split at apostrophes and dashes too", () => {
    expect(liveInitials("Sarah N'Diaye")).toBe("SN");
    expect(liveInitials("Jean-Pierre Dupont")).toBe("JP");
    expect(liveInitials("Ana María López García")).toBe("AM");
  });

  it("are a question mark for no name", () => {
    expect(liveInitials(null)).toBe("?");
    expect(liveInitials(undefined)).toBe("?");
    expect(liveInitials("")).toBe("?");
  });

  it("read Arabic and Chinese names", () => {
    expect(liveInitials("ليلى حداد")).toBe("لح");
    expect(liveInitials("李伟")).toBe("李");
  });

  // Not half of an emoji (a broken character on screen)
  it("keep an emoji at the start of a name whole", () => {
    expect(liveInitials("🎉 Party")).toBe("🎉P");
  });

  // A name of spaces alone shows "?", as an empty one does
  it("are a question mark for a name of spaces", () => {
    expect(liveInitials("   ")).toBe("?");
  });
});
