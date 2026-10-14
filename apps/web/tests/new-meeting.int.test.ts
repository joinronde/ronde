import { prisma } from "@ronde/db";
import { CATALOG } from "@ronde/modules/catalog";
import { beforeAll, describe, expect, it } from "vitest";
import { createMeeting } from "@/lib/server/meetings";
import { type Fixture, meeting, workspace } from "./fixtures";

// The creation wizard: a meeting started from nothing has no facilitation module until one is picked, and the
// sections and modules chosen in the wizard replace the template's

let f: Fixture;
const start = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const base = { startDate: start, time: "10:00", durationMin: 25, weekday: 2, personIds: [], creatorSpeaks: true, modules: {} };

beforeAll(async () => {
  f = await meeting(await workspace("wizard"), "Existing");
});

const modulesOf = async (meetingId: string) =>
  Object.fromEntries((await prisma.moduleInstallation.findMany({ where: { meetingId } })).map((m) => [m.moduleId, m.enabled]));

describe("new meeting", () => {
  it("starts from nothing: three lists, no facilitation module, any duration", async () => {
    const { id } = await createMeeting(f.ctx.ws, { ...base, name: "Blank", template: "blank" });
    const mods = await modulesOf(id);
    for (const m of CATALOG.filter((x) => x.category !== "integrations")) expect(mods[m.id], m.id).toBe(false);
    const sections = await prisma.section.findMany({ where: { meetingId: id }, orderBy: { position: "asc" } });
    expect(sections.map((s) => s.role)).toEqual(["achievement", "plan", "blocker"]);
    expect((await prisma.scheduleRule.findFirstOrThrow({ where: { meetingId: id } })).durationMin).toBe(25);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id } })).icon).toBe("📋");
  });

  it("takes the modules and sections picked in the wizard over the template's", async () => {
    const { id } = await createMeeting(f.ctx.ws, {
      ...base,
      name: "Picked",
      template: "builtin:weekly",
      modules: { polls: true, kudos: false },
      sections: [
        { key: "done", role: "achievement", input: "checklist", label: "Shipped" },
        { key: "a1b2c3d4", role: "custom", input: "text", label: "Demos" },
      ],
    });
    const mods = await modulesOf(id);
    expect(mods.polls).toBe(true);
    expect(mods.kudos).toBe(false);
    const sections = await prisma.section.findMany({ where: { meetingId: id }, orderBy: { position: "asc" } });
    expect(sections.map((s) => [s.key, s.label, s.input])).toEqual([
      ["done", "Shipped", "checklist"],
      ["a1b2c3d4", "Demos", "text"],
    ]);
  });

  it("refuses sections that cannot be filed: none, a key twice, a bad key", async () => {
    for (const sections of [
      [],
      [
        { key: "done", role: "achievement", input: "list", label: "" },
        { key: "done", role: "plan", input: "list", label: "" },
      ],
      [{ key: "Not a key!", role: "custom", input: "list", label: "" }],
    ])
      await expect(createMeeting(f.ctx.ws, { ...base, name: "Bad", template: "blank", sections })).rejects.toMatchObject({
        key: "invalidRequest",
      });
  });
});
