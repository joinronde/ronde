import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { saveLicense } from "@/lib/server/license";
import { createMeetingRoom, saveVideoAccount } from "@/lib/server/video-accounts";
import { type Fixture, meeting, workspace } from "./fixtures";

// Video accounts (Team): a lasting Zoom room for a meeting, its link saved as the meeting's

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-vid": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-vid",
    id: "lic_v",
    customer: "Acme",
    edition: "team",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;

let f: Fixture;

beforeAll(async () => {
  await saveLicense(KEY);
  f = await meeting(await workspace(`vid-${Date.now().toString(36)}`), "Weekly");
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await saveLicense("");
});

describe("video accounts", () => {
  it("refuses an incomplete account", async () => {
    await expect(saveVideoAccount(f.ctx.ws, { kind: "teams", name: "Teams", config: { tenant: "t" }, secret: "s" })).rejects.toThrow();
  });

  it("creates the room of the meeting and keeps its link", async () => {
    const { id } = await saveVideoAccount(f.ctx.ws, {
      kind: "zoom",
      name: "Zoom",
      config: { accountId: "acc", clientId: "cid" },
      secret: "zs",
    });
    const answers = [{ access_token: "zt" }, { join_url: "https://zoom.us/j/42", id: 42 }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(answers.shift()), { status: 200 })),
    );
    expect(await createMeetingRoom(f.ctx, id)).toBe("https://zoom.us/j/42");
    const m = await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } });
    expect(m.videoUrl).toBe("https://zoom.us/j/42");
    const mod = await prisma.moduleInstallation.findFirstOrThrow({ where: { meetingId: f.meetingId, moduleId: "video" } });
    expect(mod.config).toMatchObject({ provider: "link" });
  });

  it("never sends a BigBlueButton server to create a room, as a Zoom account would", async () => {
    const bbb = await prisma.videoAccount.create({
      data: { workspaceId: f.workspaceId, kind: "bbb", name: "Campus", config: { url: "https://bbb.campus.test/bigbluebutton" } },
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(createMeetingRoom(f.ctx, bbb.id)).rejects.toMatchObject({ key: "notFound" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
