import { describe, expect, it } from "vitest";
import { createSeededRandom, fromBase64Url, toBase64Url } from "../src/seeded-random";

describe("seeded random", () => {
  it("reproduces integers and shuffles for a given seed", () => {
    const first = createSeededRandom("same-seed");
    const second = createSeededRandom("same-seed");
    expect(Array.from({ length: 20 }, () => first.nextInt(17))).toEqual(Array.from({ length: 20 }, () => second.nextInt(17)));
    expect(createSeededRandom("shuffle").shuffle(["a", "b", "c", "d"])).toEqual(
      createSeededRandom("shuffle").shuffle(["a", "b", "c", "d"]),
    );
  });

  it("gives different sequences for different seeds and refuses an empty seed", () => {
    const a = Array.from({ length: 8 }, () => 0).map((_, i) => createSeededRandom(`seed-a-${i}`).nextUint32());
    const b = Array.from({ length: 8 }, () => 0).map((_, i) => createSeededRandom(`seed-b-${i}`).nextUint32());
    expect(a).not.toEqual(b);
    expect(() => createSeededRandom("  ")).toThrow(RangeError);
  });

  it("round-trips base64url", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });
});
