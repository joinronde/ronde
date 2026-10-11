import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { type Fixture, meeting, workspace } from "./fixtures";

// Video call: the link people join with follows the tool chosen in the settings

let f: Fixture;

/** The snapshot of a new request: the meeting is read again */
async function snapshot() {
  f.ctx.meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } });
  return loadSnapshot(f.ctx);
}

beforeAll(async () => {
  f = await meeting(await workspace("video"), "Weekly");
});

describe("video call", () => {
  it("keeps a free link, then opens a Jitsi room that stays the same", async () => {
    await runOp(f.ctx, { op: "video.configure", provider: "link", link: "https://meet.example.com/team", jitsiUrl: "", bbbUrl: "" });
    expect((await snapshot()).settings.videoUrl).toBe("https://meet.example.com/team");
    await runOp(f.ctx, { op: "video.configure", provider: "jitsi", link: "", jitsiUrl: "", bbbUrl: "" });
    const first = (await snapshot()).settings.videoUrl;
    expect(first).toMatch(/^https:\/\/meet\.jit\.si\/Ronde[A-Za-z2-9]{20}$/);
    await runOp(f.ctx, { op: "video.configure", provider: "jitsi", link: "", jitsiUrl: "https://jitsi.example.org", bbbUrl: "" });
    expect((await snapshot()).settings.videoUrl).toBe(first.replace("https://meet.jit.si", "https://jitsi.example.org"));
  });

  it("sends BigBlueButton through Ronde, and hides its server from participants", async () => {
    await expect(runOp(f.ctx, { op: "video.configure", provider: "bbb", link: "", jitsiUrl: "", bbbUrl: "" })).rejects.toMatchObject({
      key: "videoBbbUrl",
    });
    await runOp(f.ctx, {
      op: "video.configure",
      provider: "bbb",
      link: "",
      jitsiUrl: "",
      bbbUrl: "https://bbb.example.org/bigbluebutton",
      secret: "s",
    });
    const snap = await snapshot();
    expect(snap.settings.videoUrl).toMatch(new RegExp(`/w/[^/]+/m/${f.meetingId}/video$`));
    expect(snap.settings.tokensSet.bbb).toBe(true);
  });

  it("shows no link when the module is off", async () => {
    await prisma.moduleInstallation.update({
      where: { meetingId_moduleId: { meetingId: f.meetingId, moduleId: "video" } },
      data: { enabled: false },
    });
    expect((await snapshot()).settings.videoUrl).toBe("");
  });
});
