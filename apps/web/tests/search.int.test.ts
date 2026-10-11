import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { personProfile } from "@/lib/server/profile";
import { searchWorkspace } from "@/lib/server/search";
import { type Fixture, meeting, workspace } from "./fixtures";

// The ⌘K search and the profile pages: only what the person can see

let f: Fixture;
let other: Fixture;

beforeAll(async () => {
  f = await meeting(await workspace("search"), "Roadmap review");
  await prisma.action.create({
    data: { workspaceId: f.workspaceId, meetingId: f.meetingId, text: "Renew the staging certificate", ownerId: f.memberId },
  });
  await prisma.topic.create({ data: { workspaceId: f.workspaceId, meetingId: f.meetingId, text: "Staging costs" } });
  other = await meeting(await workspace("search-other"), "Roadmap elsewhere");
  await prisma.action.create({
    data: { workspaceId: other.workspaceId, meetingId: other.meetingId, text: "Staging of the other team", ownerId: other.memberId },
  });
});

describe("workspace search", () => {
  it("finds meetings, actions and topics of the workspace only", async () => {
    const hits = await searchWorkspace(f.ctx.ws, "staging", "en");
    expect(hits.map((h) => [h.kind, h.title]).sort()).toEqual([
      ["action", "Renew the staging certificate"],
      ["topic", "Staging costs"],
    ]);
    const meetings = await searchWorkspace(f.ctx.ws, "roadmap", "en");
    expect(meetings.map((h) => h.title)).toEqual(["Roadmap review"]);
  });

  it("finds people by any part of their name, and ignores one letter", async () => {
    const hits = await searchWorkspace(f.ctx.ws, "host", "en");
    expect(hits.some((h) => h.kind === "person" && h.href.endsWith(`/people/${f.hostPersonId}`))).toBe(true);
    expect(await searchWorkspace(f.ctx.ws, "s", "en")).toEqual([]);
  });
});

describe("profile", () => {
  it("shows a person's meetings and open actions", async () => {
    const p = await personProfile(f.ctx.ws, f.memberId);
    expect(p?.meetings.map((m) => [m.name, m.role])).toEqual([["Roadmap review", "participant"]]);
    expect(p?.actions.map((a) => a.text).sort()).toEqual(["Renew the staging certificate", "action"]);
    expect(p?.isMe).toBe(false);
  });

  it("does not exist for a person of another workspace", async () => {
    expect(await personProfile(f.ctx.ws, other.memberId)).toBeNull();
  });
});
