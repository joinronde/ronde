import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { createMeeting, listMeetings } from "@/lib/server/meetings";
import { type Fixture, meeting, workspace } from "./fixtures";

// A meeting's mark in the menus: the emoji of its template to begin with, another one, or its own image

const start = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const schedule = { startDate: start, time: "09:15", durationMin: 15, weekday: null, personIds: [], creatorSpeaks: true, modules: {} };

let f: Fixture;
beforeAll(async () => {
  f = await meeting(await workspace("icons"), "Weekly");
});

describe("a meeting's icon", () => {
  it("starts with its template's emoji", async () => {
    const { id } = await createMeeting(f.ctx.ws, { name: "Stand-up", template: "builtin:standup", ...schedule });
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id } })).icon).toBe("☀️");
    const listed = (await listMeetings(f.ctx.ws, "en")).find((m) => m.id === id)!;
    expect(listed).toMatchObject({ icon: "☀️", image: null });
  });

  it("takes one emoji, or none for the initials", async () => {
    for (const icon of ["🧪", "👩🏽‍💻", "🇫🇷"]) {
      await runOp(f.ctx, { op: "meeting.icon", icon });
      expect((await loadSnapshot(f.ctx)).settings.icon).toBe(icon);
    }
    for (const icon of ["abc", "🚀🚀", "<b>"]) await expect(runOp(f.ctx, { op: "meeting.icon", icon })).rejects.toThrow("invalidRequest");
    await runOp(f.ctx, { op: "meeting.icon", icon: "" });
    expect((await loadSnapshot(f.ctx)).settings.icon).toBe("");
  });

  it("shows its own image first, wherever it is listed", async () => {
    await prisma.meetingImage.create({
      data: { meetingId: f.meetingId, workspaceId: f.workspaceId, data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), type: "image/png" },
    });
    const version = (await loadSnapshot(f.ctx)).settings.image;
    expect(version).toBeGreaterThan(0);
    expect((await listMeetings(f.ctx.ws, "en")).find((m) => m.id === f.meetingId)!.image).toBe(version);
    // Gone with the meeting
    await prisma.meeting.delete({ where: { id: f.meetingId } });
    expect(await prisma.meetingImage.count({ where: { meetingId: f.meetingId } })).toBe(0);
  });
});
