import { describe, expect, it } from "vitest";
import { grantDue, grantOf, parseGitlabSecret } from "@/lib/shared/gitlab-grant";

// GitLab connected through OAuth rather than a personal token that expires: the grant kept, renewed in time

describe("a meeting's GitLab access", () => {
  it("reads a personal token as before, and a grant as JSON", () => {
    expect(parseGitlabSecret("glpat-abc")).toEqual({ token: "glpat-abc", grant: null });
    expect(parseGitlabSecret("")).toEqual({ token: "", grant: null });
    const grant = { kind: "oauth", access: "a1", refresh: "r1", expiresAt: 1000, user: "ines" };
    expect(parseGitlabSecret(JSON.stringify(grant))).toEqual({ token: "a1", grant });
    // Something else in braces stays a token
    expect(parseGitlabSecret('{"x":1}').grant).toBeNull();
    expect(parseGitlabSecret("{not json").token).toBe("{not json");
  });

  it("keeps GitLab's answer with the time its token runs out", () => {
    const now = Date.UTC(2026, 9, 14, 10);
    expect(grantOf({ access_token: "a", refresh_token: "r", expires_in: 7200, created_at: now / 1000 }, "ines", now)).toEqual({
      kind: "oauth",
      access: "a",
      refresh: "r",
      expiresAt: now + 7_200_000,
      user: "ines",
    });
    // No lifetime said: two hours from now
    expect(grantOf({ access_token: "a", refresh_token: "r" }, "", now).expiresAt).toBe(now + 7_200_000);
  });

  it("renews the token a minute before it runs out", () => {
    const g = grantOf({ access_token: "a", refresh_token: "r", expires_in: 600 }, "", 0);
    expect(grantDue(g, 0)).toBe(false);
    expect(grantDue(g, 539_000)).toBe(false);
    expect(grantDue(g, 540_000)).toBe(true);
  });
});
