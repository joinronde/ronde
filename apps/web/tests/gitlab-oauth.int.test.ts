import { prisma } from "@ronde/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { meetingGitlab } from "@/lib/server/gitlab";
import { connectState, readConnectState, saveGrant } from "@/lib/server/gitlab-oauth";
import { decryptSecret, encryptSecret } from "@/lib/server/secrets";
import { parseGitlabSecret } from "@/lib/shared/gitlab-grant";
import { meeting, workspace } from "./fixtures";

// GitLab connected with OAuth rather than a personal token that expires: the access token renewed in time
// and kept, the round trip signed for the person who started it

const calls: { url: string; body: string }[] = [];

beforeAll(() => {
  vi.stubEnv("GITLAB_OAUTH_CLIENT_ID", "ronde-app");
  vi.stubEnv("GITLAB_OAUTH_CLIENT_SECRET", "ronde-secret");
  vi.stubEnv("GITLAB_URL", "https://gitlab.test");
  vi.stubEnv("APP_URL", "https://ronde.test");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? "") });
    if (url === "https://gitlab.test/oauth/token")
      return Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 7200,
        created_at: Math.floor(Date.now() / 1000),
      });
    return new Response("not found", { status: 404 });
  });
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  calls.length = 0;
});

const secretOf = async (meetingId: string) =>
  (await prisma.moduleInstallation.findUniqueOrThrow({ where: { meetingId_moduleId: { meetingId, moduleId: "gitlab" } } })).secret;

describe("GitLab connected with OAuth", () => {
  it("renews an access token about to run out, keeps the new one, then uses it as it is", async () => {
    const w = await workspace(`gl-oauth-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    await saveGrant(t.ctx.ws.db, t.workspaceId, t.meetingId, {
      kind: "oauth",
      access: "old-access",
      refresh: "old-refresh",
      expiresAt: Date.now() + 10_000,
      user: "ines",
    });
    const { cfg } = await meetingGitlab(t.ctx.ws.db, t.meetingId);
    expect(cfg).toEqual({ url: "https://gitlab.test", token: "new-access", bearer: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toContain("grant_type=refresh_token");
    expect(calls[0]!.body).toContain("refresh_token=old-refresh");
    expect(parseGitlabSecret(decryptSecret(await secretOf(t.meetingId))).grant).toMatchObject({
      access: "new-access",
      refresh: "new-refresh",
      user: "ines",
    });
    // Fresh now: nothing asked of GitLab
    expect((await meetingGitlab(t.ctx.ws.db, t.meetingId)).cfg.token).toBe("new-access");
    expect(calls).toHaveLength(1);
  });

  it("keeps a personal token working as before", async () => {
    const w = await workspace(`gl-token-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    await prisma.moduleInstallation.upsert({
      where: { meetingId_moduleId: { meetingId: t.meetingId, moduleId: "gitlab" } },
      create: { workspaceId: t.workspaceId, meetingId: t.meetingId, moduleId: "gitlab", secret: encryptSecret("glpat-123") },
      update: { secret: encryptSecret("glpat-123") },
    });
    expect((await meetingGitlab(t.ctx.ws.db, t.meetingId)).cfg).toEqual({ url: "https://gitlab.test", token: "glpat-123" });
    expect(calls).toHaveLength(0);
  });

  it("signs the round trip: an altered or expired state is refused", () => {
    const state = connectState("meeting-1", "user-1", 1_000);
    expect(readConnectState(state, 2_000)).toEqual({ meetingId: "meeting-1", userId: "user-1" });
    expect(readConnectState(state.replace("user-1", "user-2"), 2_000)).toBeNull();
    expect(readConnectState(state, 1_000 + 11 * 60_000)).toBeNull();
    expect(readConnectState("nonsense", 2_000)).toBeNull();
  });
});
