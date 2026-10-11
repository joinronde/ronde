import { describe, expect, it } from "vitest";
import { availableSlug, isValidSlug, slugify, splitName } from "../src/slug";

describe("slugify", () => {
  it("strips accents and punctuation", () => {
    expect(slugify("Équipe Produit & Design!")).toBe("equipe-produit-design");
    expect(slugify("  --  ")).toBe("workspace");
  });
  it("keeps at most 40 characters without a trailing dash", () => {
    const slug = slugify(`${"a".repeat(39)} b`);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase words separated by dashes", () => {
    expect(isValidSlug("product-team")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
  });
  it("refuses reserved, empty or malformed slugs", () => {
    for (const slug of ["", "api", "-team", "team-", "Team", "a_b", "x".repeat(41)]) expect(isValidSlug(slug)).toBe(false);
  });
});

describe("availableSlug", () => {
  it("adds a number when the slug is taken", () => {
    expect(availableSlug("team", new Set())).toBe("team");
    expect(availableSlug("team", new Set(["team", "team-2"]))).toBe("team-3");
  });
  it("never returns a reserved slug", () => {
    expect(availableSlug("admin", new Set())).toBe("admin-team");
  });
});

describe("splitName", () => {
  it("splits the first word from the rest", () => {
    expect(splitName("Ada King Lovelace")).toEqual(["Ada", "King Lovelace"]);
    expect(splitName("Prince")).toEqual(["Prince", ""]);
  });
});
