import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { defaultIcebreakerBank } from "@/lib/server/meeting/modules";
import { runOp } from "@/lib/server/meeting/ops";
import { type Fixture, meeting, workspace } from "./fixtures";

// The icebreaker's questions are the meeting's language: changed with it while they are the default ones, kept
// as they are once the host wrote their own

let f: Fixture;

const settings = (locale: string) =>
  ({
    op: "settings.save",
    teamName: "Weekly",
    locale,
    hostLabel: "",
    speakSec: 60,
    autoStart: true,
    targetMin: 20,
    announcements: [],
    reminderEnabled: false,
    reminderWhen: "dayBefore",
    reminderTime: "15:00",
    sections: [{ key: "done", label: "", role: "achievement", input: "list" }],
  }) as const;

const bank = async () =>
  (
    (
      await prisma.moduleInstallation.findUniqueOrThrow({
        where: { meetingId_moduleId: { meetingId: f.meetingId, moduleId: "icebreaker" } },
      })
    ).config as { bank: string[] }
  ).bank;

/** The context again, with the meeting as saved: its language is read from it */
const fresh = async () => ({ ...f.ctx, meeting: await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } }) });

beforeAll(async () => {
  f = await meeting(await workspace("ice-lang"), "Weekly");
  await prisma.moduleInstallation.deleteMany({ where: { meetingId: f.meetingId, moduleId: "icebreaker" } });
  await runOp(f.ctx, { op: "modules.set", moduleId: "icebreaker", enabled: true });
});

describe("icebreaker questions and the meeting's language", () => {
  it("follow the language while they are the default ones", async () => {
    // The fixture's workspace speaks English
    expect(await bank()).toEqual(defaultIcebreakerBank("en"));
    await runOp(await fresh(), settings("fr"));
    expect(await bank()).toEqual(defaultIcebreakerBank("fr"));
    await runOp(await fresh(), settings("de"));
    expect(await bank()).toEqual(defaultIcebreakerBank("de"));
  });

  it("stay as the host wrote them", async () => {
    await runOp(await fresh(), { op: "icebreaker.configure", bank: ["Café ou thé ?"] });
    await runOp(await fresh(), settings("es"));
    expect(await bank()).toEqual(["Café ou thé ?"]);
  });
});
