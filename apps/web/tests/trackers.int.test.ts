import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { saveLicense } from "@/lib/server/license";
import { encryptSecret } from "@/lib/server/secrets";
import { createTicket, readRef, saveTracker, syncTickets, trackerAccess } from "@/lib/server/trackers";
import { type Fixture, meeting, workspace } from "./fixtures";

// Follow-up actions become tickets; a closed ticket closes its action (Team)

// Links in the tickets need the public address, outside of a request
process.env.APP_URL ??= "http://ronde.test";

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-trk": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-trk",
    id: "lic_t",
    customer: "Acme",
    edition: "team",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;

let f: Fixture;
const answer = (value: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })),
  );

beforeAll(async () => {
  await saveLicense(KEY);
  f = await meeting(await workspace(`trk-${Date.now().toString(36)}`), "Platform");
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await saveLicense("");
});

describe("issue trackers", () => {
  it("refuses an incomplete tracker, keeps a Jira token encrypted", async () => {
    await expect(
      saveTracker(f.ctx.ws, { kind: "jira", name: "Ops", config: { site: "nope", project: "OPS", email: "a@b.c" }, token: "x" }),
    ).rejects.toThrow();
    const { id } = await saveTracker(f.ctx.ws, {
      kind: "jira",
      name: "Ops",
      config: { site: "https://acme.atlassian.net", project: "OPS", email: "bot@acme.test" },
      token: "jira-secret",
    });
    const row = await prisma.issueTracker.findUniqueOrThrow({ where: { id } });
    expect(row.secret).not.toContain("jira-secret");
    await prisma.issueTracker.delete({ where: { id } });
  });

  it("opens GitHub and GitLab tickets with a connection of the workspace, never a meeting's own", async () => {
    const own = await prisma.forgeConnection.create({
      data: {
        workspaceId: f.workspaceId,
        meetingId: f.meetingId,
        kind: "github",
        name: "Mine",
        url: "https://api.github.com",
        secret: encryptSecret("ghp_own"),
      },
    });
    await expect(
      saveTracker(f.ctx.ws, { kind: "github", name: "App", config: { repo: "acme/app" }, token: "ghp_x" }),
    ).rejects.toMatchObject({
      key: "forgeConnectionRequired",
    });
    await expect(
      saveTracker(f.ctx.ws, { kind: "github", name: "App", config: { repo: "acme/app" }, connectionId: own.id }),
    ).rejects.toMatchObject({ key: "forgeConnectionRequired" });
    const shared = await prisma.forgeConnection.create({
      data: {
        workspaceId: f.workspaceId,
        kind: "github",
        name: "Acme",
        url: "https://api.github.com",
        secret: encryptSecret("ghp_shared"),
      },
    });
    await expect(
      saveTracker(f.ctx.ws, { kind: "github", name: "App", config: { repo: "not a repo" }, connectionId: shared.id }),
    ).rejects.toThrow();
    const { id } = await saveTracker(f.ctx.ws, { kind: "github", name: "App", config: { repo: "acme/app" }, connectionId: shared.id });
    const row = await prisma.issueTracker.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ connectionId: shared.id, secret: "" });
    expect(await trackerAccess(f.ctx.ws.db, row)).toMatchObject({
      token: "ghp_shared",
      config: { repo: "acme/app", url: "https://api.github.com" },
    });
  });

  it("opens the ticket of an action, once, then closes the action with its ticket", async () => {
    const tracker = await prisma.issueTracker.findFirstOrThrow({ where: { workspaceId: f.workspaceId, kind: "github" } });
    const sent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent.push(new Headers(init?.headers).get("authorization") ?? "");
        return new Response(JSON.stringify({ number: 42, html_url: "https://github.com/acme/app/issues/42" }), { status: 200 });
      }),
    );
    const ref = await createTicket(f.ctx.ws, f.actionId, tracker.id);
    // With the connection's token
    expect(sent).toEqual(["Bearer ghp_shared"]);
    expect(ref).toMatchObject({ key: "#42", url: "https://github.com/acme/app/issues/42", trackerId: tracker.id, closed: false });
    await expect(createTicket(f.ctx.ws, f.actionId, tracker.id)).rejects.toThrow();

    answer({ state: "open" });
    expect(await syncTickets()).toBe(0);
    answer({ state: "closed" });
    expect(await syncTickets()).toBe(1);
    const action = await prisma.action.findUniqueOrThrow({ where: { id: f.actionId } });
    expect(action.status).toBe("done");
    expect(readRef(action.externalRef)?.closed).toBe(true);
  });
});
