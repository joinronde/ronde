import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { saveLicense } from "@/lib/server/license";
import { runOp } from "@/lib/server/meeting/ops";
import { encryptSecret } from "@/lib/server/secrets";
import { processChunk, sessionTranscript } from "@/lib/server/transcripts";
import { type Fixture, meeting, workspace } from "./fixtures";

// Transcript of a session (Team): passages go to the person whose turn it was, the sound is deleted,
// people may leave their turn out

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-stt": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-stt",
    id: "lic_s",
    customer: "Acme",
    edition: "team",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;

let f: Fixture;
const START = Date.parse("2030-01-07T10:00:00Z");

beforeAll(async () => {
  await saveLicense(KEY);
  f = await meeting(await workspace(`stt-${Date.now().toString(36)}`), "Weekly");
  await prisma.workspace.update({
    where: { id: f.workspaceId },
    data: {
      settings: { transcription: { enabled: true, baseUrl: "", model: "whisper-1", language: "en", key: encryptSecret("sk-test") } },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        segments: [
          { start: 1, end: 4, text: "Hello everyone" },
          { start: 12, end: 16, text: "I shipped the billing export" },
        ],
      }),
    ),
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await saveLicense("");
});

const piece = () =>
  prisma.audioChunk.create({
    data: {
      workspaceId: f.workspaceId,
      sessionId: f.sessionId,
      data: new Uint8Array([1, 2, 3]),
      type: "audio/webm",
      startAt: new Date(START),
      endAt: new Date(START + 30_000),
      // Introduction, then the member's turn from the tenth second
      steps: [
        { at: START, key: "intro" },
        { at: START + 10_000, key: f.memberId },
      ],
    },
  });

describe("transcript", () => {
  it("records only when the meeting allows it", async () => {
    await expect(runOp(f.ctx, { op: "recording.start" })).rejects.toThrow();
    await runOp(f.ctx, { op: "transcription.allow", allowed: true });
    // The context of a new request: the meeting and the workspace settings as saved
    const settings = (await prisma.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings as object;
    const ws = { ...f.ctx.ws, workspace: { ...f.ctx.ws.workspace, settings } };
    const m = { ...f.ctx, ws, meeting: await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } }) };
    await runOp(m, { op: "recording.start" });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } })).recordingSince).not.toBeNull();
  });

  it("gives each passage to the person whose turn it was, then deletes the sound", async () => {
    const chunk = await piece();
    expect(await processChunk(chunk.id)).toBe(2);
    expect(await prisma.audioChunk.findUnique({ where: { id: chunk.id } })).toBeNull();
    const lines = await sessionTranscript(f.ctx.ws.db, f.sessionId);
    expect(lines.map((l) => [l.speakerId, l.text])).toEqual([
      [null, "Hello everyone"],
      [f.memberId, "I shipped the billing export"],
    ]);
  });

  it("leaves out the turns of a person who asked, past and coming", async () => {
    const them = {
      ...f.ctx,
      ws: { ...f.ctx.ws, member: { ...f.ctx.ws.member, personId: f.memberId } },
      viewer: { ...f.ctx.viewer, memberId: f.memberId },
    };
    await runOp(them, { op: "transcript.optOut", out: true });
    expect((await sessionTranscript(f.ctx.ws.db, f.sessionId)).some((l) => l.speakerId === f.memberId)).toBe(false);
    const chunk = await piece();
    expect(await processChunk(chunk.id)).toBe(1);
  });
});
