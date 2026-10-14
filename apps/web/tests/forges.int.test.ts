import type { ForgeItem } from "@ronde/core/types";
import { prisma } from "@ronde/db";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deleteForgeConnection,
  forgeItems,
  forgeUrl,
  listForgeConnections,
  meetingForges,
  meetingSources,
  saveForgeConnection,
} from "@/lib/server/forges";
import { runOp } from "@/lib/server/meeting/ops";
import { encryptSecret } from "@/lib/server/secrets";
import { type Fixture, meeting, workspace } from "./fixtures";

// GitLab and GitHub connections: the workspace's serve every meeting until its hosts pick, a meeting's own is
// seen by that meeting alone, the instance's comes last; tokens are checked with the forge and kept encrypted

let f: Fixture;
let other: Fixture;
const forges = (t: Fixture) =>
  prisma.moduleInstallation
    .findMany({ where: { meetingId: t.meetingId } })
    .then((rows) => meetingForges(t.ctx.ws.db, t.meetingId, Object.fromEntries(rows.map((r) => [r.moduleId, r]))));
const connection = (kind: "gitlab" | "github", name: string, meetingId: string | null = null, secret = encryptSecret("tok")) =>
  prisma.forgeConnection.create({
    data: {
      workspaceId: f.workspaceId,
      meetingId,
      kind,
      name,
      url: kind === "gitlab" ? "https://gitlab.test" : "https://api.github.test",
      secret,
    },
  });

beforeAll(async () => {
  const w = await workspace(`forges-${Date.now().toString(36)}`);
  f = await meeting(w, "Weekly");
  other = await meeting(w, "Retro");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("forge connections", () => {
  it("are the instance's while the workspace has none, then the workspace's, until the hosts pick", async () => {
    vi.stubEnv("GITLAB_TOKEN", "glpat-instance");
    expect((await forges(f)).gitlab).toEqual({ picked: false, sources: [{ connection: "instance", groups: "", projects: "" }] });
    const shared = await connection("gitlab", "Acme");
    expect((await forges(f)).gitlab.sources).toEqual([{ connection: shared.id, groups: "", projects: "" }]);
    // Picked: those ticked, with their filters; one the meeting may not use is left out
    const theirs = await connection("gitlab", "Theirs", other.meetingId);
    await runOp(f.ctx, {
      op: "gitlab.configure",
      sources: [
        { connection: "instance", groups: "acme", projects: "acme/api" },
        { connection: theirs.id, groups: "", projects: "" },
      ],
    });
    expect((await forges(f)).gitlab).toEqual({ picked: true, sources: [{ connection: "instance", groups: "acme", projects: "acme/api" }] });
    expect((await meetingSources(f.ctx.ws.db, f.meetingId, "gitlab")).map((s) => s.access)).toEqual([
      { id: "instance", kind: "gitlab", url: "https://gitlab.com", token: "glpat-instance" },
    ]);
  });

  it("of a meeting are seen by that meeting only, and used by it as soon as they are added", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ login: "ana" }));
    await runOp(f.ctx, { op: "forge.add", kind: "github", name: "Ana's", token: "ghp_ana" });
    const own = await prisma.forgeConnection.findFirstOrThrow({ where: { meetingId: f.meetingId, kind: "github" } });
    expect(own.account).toBe("ana");
    // GitHub is off until turned on: a connection added for it turns it on
    expect((await prisma.moduleInstallation.findFirstOrThrow({ where: { meetingId: f.meetingId, moduleId: "github" } })).enabled).toBe(
      true,
    );
    expect((await forges(f)).github.sources).toContainEqual({ connection: own.id, repos: "" });
    expect((await listForgeConnections(f.ctx.ws.db, null)).some((c) => c.id === own.id)).toBe(false);
    expect((await listForgeConnections(other.ctx.ws.db, other.meetingId)).some((c) => c.id === own.id)).toBe(false);
    // Another meeting cannot remove it either
    await expect(runOp(other.ctx, { op: "forge.remove", id: own.id })).rejects.toMatchObject({ key: "notFound" });
    await runOp(f.ctx, { op: "forge.remove", id: own.id });
    expect(await prisma.forgeConnection.count({ where: { id: own.id } })).toBe(0);
  });

  it("check their token with the forge before keeping it, and say whose account it is", async () => {
    const asked: { url: string; auth: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      asked.push({ url, auth: new Headers(init?.headers).get("authorization") ?? "" });
      return url.endsWith("/user") && new Headers(init?.headers).get("authorization") === "Bearer glpat-good"
        ? Response.json({ username: "ines" })
        : new Response("", { status: 401 });
    });
    await expect(
      saveForgeConnection(f.ctx.ws, { kind: "gitlab", name: "Own", url: "https://gitlab.acme.test/api/v4/", token: "glpat-bad" }, null),
    ).rejects.toMatchObject({ key: "gitlabTokenRefused" });
    const { id } = await saveForgeConnection(
      f.ctx.ws,
      { kind: "gitlab", name: "Own", url: "https://gitlab.acme.test/api/v4/", token: "glpat-good" },
      null,
    );
    expect(asked.at(-1)).toEqual({ url: "https://gitlab.acme.test/api/v4/user", auth: "Bearer glpat-good" });
    const row = await prisma.forgeConnection.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ url: "https://gitlab.acme.test", account: "ines", meetingId: null });
    expect(row.secret).not.toContain("glpat-good");
    // Another server keeps no token of the first one
    await expect(
      saveForgeConnection(f.ctx.ws, { id, kind: "gitlab", name: "Own", url: "https://elsewhere.test" }, null),
    ).rejects.toMatchObject({
      key: "connectorSecretRequired",
    });
  });

  it("take https addresses, and http only on a self-hosted server", () => {
    expect(forgeUrl("gitlab", "")).toBe("https://gitlab.com");
    expect(forgeUrl("gitlab", " https://git.acme.test/ ")).toBe("https://git.acme.test");
    expect(forgeUrl("gitlab", "http://git.acme.lan")).toBe("http://git.acme.lan");
    expect(() => forgeUrl("gitlab", "git.acme.test")).toThrow();
    expect(() => forgeUrl("gitlab", "ftp://git.acme.test")).toThrow();
    vi.stubEnv("RONDE_CLOUD", "1");
    expect(() => forgeUrl("gitlab", "http://git.acme.lan")).toThrow();
  });

  it("whose secret cannot be read still list, rather than taking the meeting down", async () => {
    const broken = await connection("gitlab", "Broken", null, "v1:not-really-encrypted");
    const list = await listForgeConnections(f.ctx.ws.db, f.meetingId);
    expect(list.find((c) => c.id === broken.id)).toMatchObject({ name: "Broken", oauth: false });
  });

  it("of a meeting reach the instance's server, unless an administrator adds them", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ username: "hana" }));
    const host = { ...f.ctx, can: (p: string) => p !== "connectors.manage" && f.ctx.can(p as never) };
    host.ws = { ...f.ctx.ws, can: (p: string) => p !== "connectors.manage" && f.ctx.ws.can(p as never) };
    // From Ronde's network: a host could otherwise make the server call any address
    await expect(
      runOp(host, { op: "forge.add", kind: "gitlab", url: "https://intranet.acme.test", token: "glpat-x" }),
    ).rejects.toMatchObject({
      status: 403,
      key: "forgeServerAdminOnly",
    });
    expect(await prisma.forgeConnection.count({ where: { meetingId: f.meetingId, url: "https://intranet.acme.test" } })).toBe(0);
    await runOp(host, { op: "forge.add", kind: "gitlab", name: "Hana's", token: "glpat-x" });
    expect(await prisma.forgeConnection.count({ where: { meetingId: f.meetingId, url: "https://gitlab.com" } })).toBe(1);
    await runOp(f.ctx, { op: "forge.add", kind: "gitlab", name: "Intranet", url: "https://intranet.acme.test", token: "glpat-x" });
    expect(await prisma.forgeConnection.count({ where: { meetingId: f.meetingId, url: "https://intranet.acme.test" } })).toBe(1);
  });

  it("refuse an address that answers with a page rather than the forge's API", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(
      saveForgeConnection(f.ctx.ws, { kind: "github", name: "Site", url: "https://github.com", token: "ghp_x" }, null),
    ).rejects.toMatchObject({ key: "forgeUrlInvalid" });
  });

  it("that cannot be read leave the meeting's other connections working", async () => {
    vi.stubEnv("GITLAB_TOKEN", "");
    const good = await connection("gitlab", "Good");
    const broken = await connection("gitlab", "Unreadable", null, "v1:not-really-encrypted");
    await runOp(f.ctx, {
      op: "gitlab.configure",
      sources: [
        { connection: broken.id, groups: "", projects: "" },
        { connection: good.id, groups: "", projects: "" },
      ],
    });
    expect((await meetingSources(f.ctx.ws.db, f.meetingId, "gitlab")).map((s) => s.access.id)).toEqual([good.id]);
  });

  it("are not decrypted for the people who do not configure the meeting", async () => {
    const decrypt = vi.spyOn(await import("@/lib/server/secrets"), "decryptSecret");
    const theirs = await meetingForges(f.ctx.ws.db, f.meetingId, {}, false);
    expect(theirs.connections.length).toBeGreaterThan(0);
    expect(decrypt).not.toHaveBeenCalled();
    // Those who do see whether each was made with OAuth
    await meetingForges(f.ctx.ws.db, f.meetingId, {}, true);
    expect(decrypt).toHaveBeenCalled();
    decrypt.mockRestore();
  });

  it("removed take the trackers that opened tickets with them", async () => {
    const shared = await connection("github", "Shared");
    const tracker = await prisma.issueTracker.create({
      data: { workspaceId: f.workspaceId, kind: "github", name: "App", config: { repo: "acme/app" }, connectionId: shared.id },
    });
    await deleteForgeConnection(f.ctx.ws, shared.id, null);
    expect(await prisma.issueTracker.count({ where: { id: tracker.id } })).toBe(0);
  });
});

describe("forge items through several connections", () => {
  const item = (id: string): ForgeItem => ({
    id,
    ref: "#1",
    title: "T",
    project: "app",
    path: "acme/app",
    state: "opened",
    assignee: null,
    updatedAt: 0,
    url: "",
  });
  const source = (id: string) => ({ access: { id, kind: "gitlab" as const, url: "", token: "t" } });

  it("tells apart two servers' items with the same ids, and keeps those of a server that answered", async () => {
    const items = await forgeItems([source("a"), source("b"), source("c")], async ({ access }) => {
      if (access.id === "c") throw new Error("down");
      return [item("issue-1")];
    });
    expect(items.map((i) => i.id)).toEqual(["a:issue-1", "b:issue-1"]);
  });

  it("shows once an item read through two connections to the same server", async () => {
    const same = { ...item("issue-1"), url: "https://gitlab.test/acme/app/-/issues/1" };
    const items = await forgeItems([source("a"), source("b")], async () => [same]);
    expect(items.map((i) => i.id)).toEqual(["a:issue-1"]);
  });

  it("fails when every connection failed", async () => {
    await expect(
      forgeItems([source("a")], async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
  });
});
