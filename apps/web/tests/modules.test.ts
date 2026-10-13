import type { PokerDTO, RetroDTO } from "@ronde/core/types";
import { describe, expect, it } from "vitest";
import { average, byVotes, currentItem, sector, titleOf } from "@/lib/shared/modules";

// What the meeting modules show: the poker item being estimated and its average, the retro groups' names and
// order, the sectors of the random wheel

describe("the poker item being estimated", () => {
  const item = (id: string, final: string | null = null) => ({
    id,
    title: id,
    position: 0,
    revealed: false,
    final,
    voted: 0,
    votes: [],
    myVote: null,
  });
  const poker = (...items: PokerDTO["items"]): PokerDTO => ({ live: true, deck: [], items });

  it("is none without items", () => {
    expect(currentItem(poker())).toBeUndefined();
  });

  it("is the only item, estimated or not", () => {
    expect(currentItem(poker(item("a")))?.id).toBe("a");
    expect(currentItem(poker(item("a", "5")))?.id).toBe("a");
  });

  it("is the first one without an estimate", () => {
    expect(currentItem(poker(item("a", "3"), item("b"), item("c")))?.id).toBe("b");
  });

  it("is the last one once all are estimated", () => {
    expect(currentItem(poker(item("a", "3"), item("b", "?"), item("c", "☕")))?.id).toBe("c");
  });

  it("counts an empty estimate as given", () => {
    // Only null means not estimated yet
    expect(currentItem(poker(item("a", ""), item("b")))?.id).toBe("b");
  });

  it("is found among fifty", () => {
    const items = Array.from({ length: 50 }, (_, i) => item(`i${i}`, i < 49 ? "8" : null));
    expect(currentItem(poker(...items))?.id).toBe("i49");
  });
});

describe("the poker average", () => {
  const votes = (...values: string[]) => values.map((value) => ({ value }));

  it("is none without votes", () => {
    expect(average([])).toBeNull();
  });

  it("is none when no card is a number", () => {
    expect(average(votes("?", "☕"))).toBeNull();
    expect(average(votes("XS", "M", "XL"))).toBeNull();
  });

  it("is the card itself for one vote", () => {
    expect(average(votes("13"))).toBe(13);
    expect(average(votes("0"))).toBe(0);
  });

  it("leaves out the cards that are not numbers", () => {
    expect(average(votes("1", "2", "?", "☕", "3"))).toBe(2);
    expect(average(votes("5", "8"))).toBe(6.5);
  });

  it("counts each vote, the same card several times included", () => {
    expect(average(votes("8", "8", "8", "1"))).toBe(6.25);
  });

  it("holds the whole team on the biggest cards", () => {
    expect(average(votes(...Array.from({ length: 50 }, () => "32")))).toBe(32);
  });

  it("ignores infinities and digits of other scripts", () => {
    // Number() reads neither Arabic-Indic nor Devanagari digits; the decks only use ASCII ones
    expect(average(votes("Infinity", "٣", "३", "2"))).toBe(2);
  });
});

describe("a retro group's name", () => {
  const group = (id: string, title = "", votes = 0, position = 0) => ({ id, column: "good", title, position, votes, mine: false });
  const card = (id: string, groupId: string | null, text: string) => ({ id, column: "good", groupId, text, mine: false });

  it("is the title the host gave", () => {
    expect(titleOf(group("g1", "Release process"), [card("c1", "g1", "Fast deploys")])).toBe("Release process");
  });

  it("is its first note until then", () => {
    const cards = [
      card("c0", null, "Loose"),
      card("c1", "g2", "Other group"),
      card("c2", "g1", "Fast deploys"),
      card("c3", "g1", "Green CI"),
    ];
    expect(titleOf(group("g1"), cards)).toBe("Fast deploys");
  });

  it("is blank for an empty group without a title", () => {
    expect(titleOf(group("g1"), [])).toBe("");
    expect(titleOf(group("g1"), [card("c1", "g1", "")])).toBe("");
  });

  it("keeps right-to-left text and emoji as written", () => {
    expect(titleOf(group("g1"), [card("c1", "g1", "نشر أسرع 🚀")])).toBe("نشر أسرع 🚀");
    expect(titleOf(group("g1", "עבודת צוות"), [])).toBe("עבודת צוות");
  });
});

describe("retro groups by votes", () => {
  const group = (id: string, votes: number, position: number): RetroDTO["groups"][number] => ({
    id,
    column: "good",
    title: id,
    position,
    votes,
    mine: false,
  });
  const order = (groups: RetroDTO["groups"]) => [...groups].sort(byVotes).map((g) => g.id);

  it("leave no group and one group alone", () => {
    expect(order([])).toEqual([]);
    expect(order([group("a", 0, 0)])).toEqual(["a"]);
  });

  it("put the most voted first", () => {
    expect(order([group("a", 1, 0), group("b", 5, 1), group("c", 3, 2)])).toEqual(["b", "c", "a"]);
  });

  it("keep the host's order between equal votes", () => {
    expect(order([group("c", 2, 2), group("a", 2, 0), group("b", 2, 1), group("d", 4, 3)])).toEqual(["d", "a", "b", "c"]);
  });

  it("sort fifty groups without votes in the host's order", () => {
    const groups = Array.from({ length: 50 }, (_, i) => group(`g${i}`, 0, 49 - i));
    expect(order(groups)).toEqual(groups.map((g) => g.id).reverse());
  });
});

describe("a sector of the wheel", () => {
  // The two corners of a sector, read back from its path
  const ends = (d: string) => {
    const m = /^M0 0 L(\S+) (\S+) A100 100 0 ([01]) 1 (\S+) (\S+) Z$/.exec(d);
    if (!m) throw new Error(`Not a sector: ${d}`);
    return { from: [Number(m[1]), Number(m[2])], large: m[3], to: [Number(m[4]), Number(m[5])] };
  };

  it("is the top half for the first of two people", () => {
    expect(sector(0, 180)).toBe("M0 0 L-100.00 -0.00 A100 100 0 0 1 100.00 0.00 Z");
    expect(sector(180, 180)).toBe("M0 0 L100.00 0.00 A100 100 0 0 1 -100.00 0.00 Z");
  });

  it("is centred on its angle, clockwise from the top", () => {
    // A quarter around 3 o'clock runs from 1:30 to 4:30
    const { from, to, large } = ends(sector(90, 90));
    expect(from).toEqual([70.71, -70.71]);
    expect(to).toEqual([70.71, 70.71]);
    expect(large).toBe("0");
  });

  it("takes the long way round past half the wheel", () => {
    expect(ends(sector(0, 240)).large).toBe("1");
    expect(ends(sector(0, 180)).large).toBe("0");
  });

  it("stays on the circle for fifty people", () => {
    const size = 360 / 50;
    for (let i = 0; i < 50; i++) {
      const { from, to } = ends(sector(i * size, size));
      for (const [x, y] of [from, to]) expect(Math.hypot(x!, y!)).toBeCloseTo(100, 1);
    }
    // Neighbours share their edge
    expect(ends(sector(0, size)).to).toEqual(ends(sector(size, size)).from);
  });

  it("starts and ends at the same point for one person, which SVG draws as nothing", () => {
    // Never shown: the server refuses a draw of fewer than two people
    const { from, to } = ends(sector(0, 360));
    expect(from[0]).toBeCloseTo(to[0]!, 5);
    expect(from[1]).toBeCloseTo(to[1]!, 5);
  });
});
