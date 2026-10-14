import { prisma } from "@ronde/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { forgeAccess, meetingForges, saveConnectionGrant, saveOAuthConnection } from "@/lib/server/forges";
import { connectState, readConnectState } from "@/lib/server/gitlab-oauth";
import { decryptSecret, encryptSecret } from "@/lib/server/secrets";
import { parseGitlabSecret } from "@/lib/shared/gitlab-grant";
import { meeting, workspace } from "./fixtures";

// GitLab connected with OAuth rather than a personal token that expires: the access token renewed in time
// and kept in its connection, the round trip signed for the person who started it and for where it goes

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

const grant = (access: string, expiresAt: number) => ({
  kind: "oauth" as const,
  access,
  refresh: `${access}-refresh`,
  expiresAt,
  user: "ines",
});

describe("GitLab connected with OAuth", () => {
  it("renews an access token about to run out, keeps the new one, then uses it as it is", async () => {
    const w = await workspace(`gl-oauth-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const c = await prisma.forgeConnection.create({
      data: { workspaceId: t.workspaceId, kind: "gitlab", name: "GitLab", url: "https://gitlab.test" },
    });
    await saveConnectionGrant(t.ctx.ws.db, c.id, grant("old-access", Date.now() + 10_000));
    expect(await forgeAccess(t.ctx.ws.db, c.id, null)).toEqual({
      id: c.id,
      kind: "gitlab",
      url: "https://gitlab.test",
      token: "new-access",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toContain("grant_type=refresh_token");
    expect(calls[0]!.body).toContain("refresh_token=old-access-refresh");
    const row = await prisma.forgeConnection.findUniqueOrThrow({ where: { id: c.id } });
    expect(parseGitlabSecret(decryptSecret(row.secret)).grant).toMatchObject({
      access: "new-access",
      refresh: "new-refresh",
      user: "ines",
    });
    expect(row.account).toBe("ines");
    // Fresh now: nothing asked of GitLab
    expect((await forgeAccess(t.ctx.ws.db, c.id, t.meetingId))?.token).toBe("new-access");
    expect(calls).toHaveLength(1);
  });

  it("uses a personal token as it is", async () => {
    const w = await workspace(`gl-token-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const c = await prisma.forgeConnection.create({
      data: { workspaceId: t.workspaceId, kind: "gitlab", name: "GitLab", url: "https://gitlab.test", secret: encryptSecret("glpat-123") },
    });
    expect((await forgeAccess(t.ctx.ws.db, c.id, null))?.token).toBe("glpat-123");
    expect(calls).toHaveLength(0);
  });

  it("from a meeting, makes a connection of its own that it uses right away and no other meeting sees", async () => {
    const w = await workspace(`gl-own-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const other = await meeting(w, "Retro");
    const { id } = await saveOAuthConnection(t.ctx.ws, { meetingId: t.meetingId, connectionId: null }, grant("a", Date.now() + 3_600_000));
    const mods = { gitlab: await prisma.moduleInstallation.findFirst({ where: { meetingId: t.meetingId, moduleId: "gitlab" } }) };
    const forges = await meetingForges(t.ctx.ws.db, t.meetingId, mods);
    expect(forges.connections.find((c) => c.id === id)).toMatchObject({
      scope: "meeting",
      oauth: true,
      account: "ines",
      name: "GitLab @ines",
    });
    expect(forges.gitlab).toEqual({ picked: true, sources: [{ connection: id, groups: "", projects: "" }] });
    expect(await forgeAccess(other.ctx.ws.db, id, other.meetingId)).toBeNull();
    expect(await forgeAccess(t.ctx.ws.db, id, null)).toBeNull();
    expect((await meetingForges(other.ctx.ws.db, other.meetingId, {})).connections.some((c) => c.id === id)).toBe(false);
  });

  it("connects an existing connection again, keeping where it is used", async () => {
    const w = await workspace(`gl-again-${Date.now().toString(36)}`);
    const t = await meeting(w, "Weekly");
    const { id } = await saveOAuthConnection(t.ctx.ws, { meetingId: null, connectionId: null }, grant("first", Date.now() + 3_600_000));
    const again = await saveOAuthConnection(t.ctx.ws, { meetingId: null, connectionId: id }, grant("second", Date.now() + 3_600_000));
    expect(again.id).toBe(id);
    expect(await prisma.forgeConnection.count({ where: { workspaceId: t.workspaceId, meetingId: null } })).toBe(1);
    expect((await forgeAccess(t.ctx.ws.db, id, null))?.token).toBe("second");
  });

  it("signs the round trip: an altered or expired state is refused", () => {
    const target = { workspaceId: "ws-1", meetingId: "meeting-1", connectionId: null, userId: "user-1" };
    const state = connectState(target, 1_000);
    expect(readConnectState(state, 2_000)).toEqual(target);
    expect(readConnectState(state.replace("user-1", "user-2"), 2_000)).toBeNull();
    expect(readConnectState(state.replace("meeting-1", "meeting-2"), 2_000)).toBeNull();
    expect(readConnectState(state, 1_000 + 11 * 60_000)).toBeNull();
    expect(readConnectState("nonsense", 2_000)).toBeNull();
    // The workspace's own: no meeting
    const workspaceWide = { ...target, meetingId: null, connectionId: "c-1" };
    expect(readConnectState(connectState(workspaceWide, 1_000), 2_000)).toEqual(workspaceWide);
  });
});
