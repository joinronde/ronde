import { describe, expect, it } from "vitest";
import { connectedGitlabUser } from "@/lib/server/meeting/dto";

// The GitLab account a meeting is connected with is read from its encrypted secret for every snapshot: a secret
// that could not be read (the encryption key changed, or none is set) used to take the whole meeting down

describe("the connected GitLab account", () => {
  it("is nobody when there is no secret, or when it cannot be read, instead of failing the meeting", () => {
    expect(connectedGitlabUser(null)).toBeNull();
    expect(connectedGitlabUser("")).toBeNull();
    expect(connectedGitlabUser("v1:not-really-encrypted")).toBeNull();
    expect(connectedGitlabUser("glpat-a-plain-token")).toBeNull();
  });
});
