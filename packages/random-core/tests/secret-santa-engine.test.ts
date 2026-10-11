import { describe, expect, it } from "vitest";
import { assignSecretSanta } from "../src/secret-santa-engine";

describe("secret santa engine", () => {
  const participants = ["a", "b", "c", "d"].map((id) => ({ id, name: id.toUpperCase() }));

  it("creates a reproducible derangement with unique recipients", () => {
    const result = assignSecretSanta(participants, [{ participantIds: ["a", "b"] }], "santa");
    expect(result).toEqual(assignSecretSanta(participants, [{ participantIds: ["a", "b"] }], "santa"));
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(new Set(result.assignments.map(({ recipientId }) => recipientId))).toHaveLength(participants.length);
    expect(result.assignments.every(({ giverId, recipientId }) => giverId !== recipientId)).toBe(true);
    expect(result.assignments.find(({ giverId }) => giverId === "a")?.recipientId).not.toBe("b");
  });

  it("reports impossible exclusion sets", () => {
    const result = assignSecretSanta(
      participants.slice(0, 3),
      [{ participantIds: ["a", "b"] }, { participantIds: ["a", "c"] }],
      "impossible",
    );
    expect(result.status).toBe("unsatisfiable");
  });
});
