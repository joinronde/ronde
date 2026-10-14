import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { createMeeting } from "@/lib/server/meetings";
import { encryptSecret } from "@/lib/server/secrets";
import { deleteTemplate, meetingTemplate, resolveTemplate } from "@/lib/server/templates";
import { type Fixture, meeting, workspace } from "./fixtures";

// Templates: a meeting saved as a template, and a meeting created from it, keep the format and nothing private

const TOKEN = "glpat-very-secret-token";
let f: Fixture;
let other: Fixture;
let shared: string;
const gitlabConfig = () => ({
  picked: true,
  sources: [
    { connection: f.forgeConnectionId, groups: "", projects: "" },
    { connection: shared, groups: "", projects: "team/app" },
  ],
});

// From next week: the first session is prepared right away
const start = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const schedule = { startDate: start, time: "09:15", durationMin: 45, weekday: 3, personIds: [], creatorSpeaks: true, modules: {} };

beforeAll(async () => {
  f = await meeting(await workspace("tpl"), "Design review");
  other = await meeting(await workspace("tpl-other"), "Other");
  // GitLab through the workspace's connection and the meeting's own, which a copy cannot see
  shared = (
    await prisma.forgeConnection.create({
      data: { workspaceId: f.workspaceId, kind: "gitlab", name: "Acme", url: "https://gitlab.test", secret: encryptSecret(TOKEN) },
    })
  ).id;
  // Something private on the meeting: a GitLab token and a notification rule
  await prisma.meeting.update({
    where: { id: f.meetingId },
    data: { targetMin: 40, speakSec: 200, hostLabel: "Chair", announcements: ["Hello"] },
  });
  await prisma.moduleInstallation.upsert({
    where: { meetingId_moduleId: { meetingId: f.meetingId, moduleId: "gitlab" } },
    create: {
      workspaceId: f.workspaceId,
      meetingId: f.meetingId,
      moduleId: "gitlab",
      enabled: true,
      config: gitlabConfig(),
      secret: encryptSecret(TOKEN),
    },
    update: { config: gitlabConfig(), secret: encryptSecret(TOKEN) },
  });
  await prisma.moduleInstallation.upsert({
    where: { meetingId_moduleId: { meetingId: f.meetingId, moduleId: "kudos" } },
    create: { workspaceId: f.workspaceId, meetingId: f.meetingId, moduleId: "kudos", enabled: false, config: {} },
    update: { enabled: false },
  });
  await prisma.moduleInstallation.upsert({
    where: { meetingId_moduleId: { meetingId: f.meetingId, moduleId: "video" } },
    create: {
      workspaceId: f.workspaceId,
      meetingId: f.meetingId,
      moduleId: "video",
      enabled: true,
      config: { ...VIDEO, room: "SourceRoom" },
    },
    update: { config: { ...VIDEO, room: "SourceRoom" } },
  });
  await prisma.section.create({
    data: { workspaceId: f.workspaceId, meetingId: f.meetingId, key: "demo", label: "Demos", role: "custom", input: "text", position: 9 },
  });
});

// As a template saved before a setting existed keeps it (no bbbAccount): the others still come with it
const VIDEO = { provider: "jitsi", jitsiUrl: "", bbbUrl: "" };

describe("templates", () => {
  it("saves a meeting as a template without its secrets", async () => {
    await runOp(f.ctx, { op: "template.save", name: "Design review", description: "Our format", icon: "" });
    const row = await prisma.template.findFirstOrThrow({ where: { workspaceId: f.workspaceId } });
    const json = JSON.stringify(row.data);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain(f.memberId);
    expect(row.data).toMatchObject({ v: 1, settings: { targetMin: 40, speakSec: 200, hostLabel: "Chair", announcements: ["Hello"] } });
  });

  it("creates a meeting with the same format, people apart", async () => {
    const row = await prisma.template.findFirstOrThrow({ where: { workspaceId: f.workspaceId } });
    const { id } = await createMeeting(f.ctx.ws, { name: "Design review 2", template: row.id, ...schedule });
    const [source, copy] = await Promise.all([meetingTemplate(f.ctx.ws.db, f.meetingId), meetingTemplate(f.ctx.ws.db, id)]);
    expect(copy.sections).toEqual(source.sections);
    expect(copy.settings).toEqual(source.settings);
    expect(copy.modules.kudos?.enabled).toBe(false);
    expect(copy.modules.gitlab?.config).toEqual({ picked: true, sources: [{ connection: shared, groups: "", projects: "team/app" }] });
    // The video tool is kept, the Jitsi room is the new meeting's own
    const room = (
      (await prisma.moduleInstallation.findFirstOrThrow({ where: { meetingId: id, moduleId: "video" } })).config as { room: string }
    ).room;
    expect(copy.modules.video?.config).toMatchObject({ provider: "jitsi", room: "" });
    expect(room).toMatch(/^[A-Za-z2-9]{20}$/);
    // The first pattern takes the day and time picked in the wizard
    expect(copy.schedule[0]).toMatchObject({ freq: "weekly", byDay: [3], time: "09:15", durationMin: 45 });
    expect((await prisma.moduleInstallation.findFirstOrThrow({ where: { meetingId: id, moduleId: "gitlab" } })).secret).toBe("");
    expect(await prisma.notificationRule.count({ where: { meetingId: id } })).toBe(0);
    // First session: the first Wednesday from the start date
    const session = await prisma.session.findFirstOrThrow({ where: { meetingId: id, status: "current" } });
    expect(session.date >= start).toBe(true);
    expect(new Date(`${session.date}T12:00:00Z`).getUTCDay()).toBe(3);
    expect(session.time).toBe("09:15");
  });

  it("creates a stand-up from the built-in template", async () => {
    const { id } = await createMeeting(f.ctx.ws, { name: "Stand-up", template: "builtin:standup", ...schedule, weekday: null });
    const copy = await meetingTemplate(f.ctx.ws.db, id);
    expect(copy.schedule).toEqual([
      { freq: "daily", interval: 1, byDay: [1, 2, 3, 4, 5], setPos: null, monthDay: null, time: "09:15", durationMin: 45 },
    ]);
    expect(copy.sections.map((s) => [s.key, s.role, s.label])).toEqual([
      ["yesterday", "achievement", "Yesterday"],
      ["today", "plan", "Today"],
      ["blockers", "blocker", ""],
    ]);
    expect(copy.modules.icebreaker?.enabled).toBe(false);
    expect(copy.settings).toMatchObject({ targetMin: 15, speakSec: 90 });
  });

  it("opens a meeting with the round its host picked, and takes the handover's time picked", async () => {
    const team = await createMeeting(f.ctx.ws, { name: "Teams", template: "builtin:teamProjects", ...schedule });
    const projects = await createMeeting(f.ctx.ws, { name: "Projects", template: "builtin:teamProjects", ...schedule, first: "projects" });
    const blocks = async (id: string) =>
      ((await prisma.meeting.findUniqueOrThrow({ where: { id }, select: { agenda: true } })).agenda as { type: string }[]).map(
        (b) => b.type,
      );
    expect(await blocks(team.id)).toEqual(["intro", "round", "projects", "topics"]);
    expect(await blocks(projects.id)).toEqual(["intro", "projects", "round", "topics"]);
    const shifts = await createMeeting(f.ctx.ws, {
      name: "Ward",
      template: "builtin:shiftHandover",
      ...schedule,
      time: "06:45",
      durationMin: 20,
    });
    const rules = await prisma.scheduleRule.findMany({ where: { meetingId: shifts.id }, orderBy: { position: "asc" } });
    // One handover a day: a meeting holds one session a day
    expect(rules.map((r) => [r.time, r.durationMin])).toEqual([["06:45", 20]]);
  });

  it("never reaches another workspace's template", async () => {
    const row = await prisma.template.findFirstOrThrow({ where: { workspaceId: f.workspaceId } });
    await expect(resolveTemplate(other.ctx.ws, row.id, "en")).rejects.toMatchObject({ key: "notFound" });
    await expect(deleteTemplate(other.ctx.ws, row.id)).rejects.toMatchObject({ key: "notFound" });
    await expect(createMeeting(other.ctx.ws, { name: "Stolen", template: row.id, ...schedule })).rejects.toMatchObject({ key: "notFound" });
  });

  it("lets members delete only the templates they saved", async () => {
    const row = await prisma.template.findFirstOrThrow({ where: { workspaceId: f.workspaceId } });
    const member = { ...f.ctx.ws, user: { ...f.ctx.ws.user, id: "someone-else" }, can: (p: string) => p !== "workspace.manage" };
    await expect(deleteTemplate(member as typeof f.ctx.ws, row.id)).rejects.toMatchObject({ key: "accessDenied" });
    await deleteTemplate(f.ctx.ws, row.id);
    expect(await prisma.template.count({ where: { workspaceId: f.workspaceId } })).toBe(0);
  });
});
