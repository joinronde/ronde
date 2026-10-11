import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { saveLicense } from "@/lib/server/license";
import { createTicket, readRef, saveTracker, syncTickets } from "@/lib/server/trackers";
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
  it("refuses an incomplete tracker, keeps the token encrypted", async () => {
    await expect(saveTracker(f.ctx.ws, { kind: "github", name: "App", config: { repo: "not a repo" }, token: "ghp_x" })).rejects.toThrow();
    const { id } = await saveTracker(f.ctx.ws, { kind: "github", name: "App", config: { repo: "acme/app" }, token: "ghp_secret" });
    const row = await prisma.issueTracker.findUniqueOrThrow({ where: { id } });
    expect(row.secret).not.toContain("ghp_secret");
  });

  it("opens the ticket of an action, once, then closes the action with its ticket", async () => {
    const tracker = await prisma.issueTracker.findFirstOrThrow({ where: { workspaceId: f.workspaceId } });
    answer({ number: 42, html_url: "https://github.com/acme/app/issues/42" });
    const ref = await createTicket(f.ctx.ws, f.actionId, tracker.id);
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
