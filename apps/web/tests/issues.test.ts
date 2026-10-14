import { describe, expect, it } from "vitest";
import { z } from "zod";
import { issuesText } from "@/lib/server/issues";

// A refused input is said in the reader's language, never in zod's English ("Too small: expected number to be >=2")

const issuesOf = (schema: z.ZodType, value: unknown) => {
  const parsed = schema.safeParse(value);
  if (parsed.success) throw new Error("expected a failure");
  return parsed.error.issues;
};

describe("issuesText", () => {
  it("says the limits in French", () => {
    expect(issuesText(issuesOf(z.object({ teamSize: z.number().min(2) }), { teamSize: 1 }), "fr")).toBe("2 au minimum");
    expect(issuesText(issuesOf(z.number().max(10), 11), "fr")).toBe("10 au maximum");
    expect(issuesText(issuesOf(z.string().min(3), "a"), "fr")).toBe("au moins 3 caractères");
    expect(issuesText(issuesOf(z.string().max(1), "ab"), "fr")).toBe("1 caractère au maximum");
    expect(issuesText(issuesOf(z.array(z.string()).min(2), ["a"]), "fr")).toBe("au moins 2 éléments");
    expect(issuesText(issuesOf(z.array(z.string()).max(1), ["a", "b"]), "fr")).toBe("1 élément au maximum");
  });
  it("names the other refusals without zod's words, each once", () => {
    expect(issuesText(issuesOf(z.string().email(), "nope"), "en")).toBe("a value is not in the expected format");
    expect(issuesText(issuesOf(z.object({ a: z.string(), b: z.string() }), {}), "en")).toBe("a value is missing");
    expect(issuesText(issuesOf(z.enum(["x", "y"]), "z"), "en")).toBe("a value is not accepted");
    const text = issuesText(issuesOf(z.object({ a: z.number().min(2) }), { a: 1 }), "de");
    expect(text).not.toMatch(/Too small|expected/);
  });
});

describe("InputError", () => {
  it("is an invalid request for the code that catches it, with the issues kept to be said later", async () => {
    const { InputError } = await import("@/lib/server/errors");
    const e = new InputError([{ code: "too_small", origin: "number", minimum: 2 }]);
    expect(e).toMatchObject({ key: "invalidRequest", status: 400 });
    expect(issuesText(e.issues, "fr")).toBe("2 au minimum");
  });
});
