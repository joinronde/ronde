import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// "Connect with GitLab" went around the module's edition, which its operations check: on an edition without the
// module, connecting would have installed it and served its data

vi.mock("@/lib/server/meeting/modules", async (original) => ({
  ...(await original<typeof import("@/lib/server/meeting/modules")>()),
  moduleAllowed: () => false,
}));

beforeAll(() => {
  vi.stubEnv("GITLAB_OAUTH_CLIENT_ID", "ronde-app");
  vi.stubEnv("GITLAB_OAUTH_CLIENT_SECRET", "ronde-secret");
});
afterAll(() => vi.unstubAllEnvs());

describe("GitLab connected with OAuth, on an edition without the module", () => {
  it("is neither offered nor started", async () => {
    const { connectUrl, gitlabOAuthOn } = await import("@/lib/server/gitlab-oauth");
    expect(gitlabOAuthOn()).toBe(false);
    await expect(connectUrl("meeting", "user")).rejects.toMatchObject({ status: 403, key: "moduleNotInEdition" });
  });
});
