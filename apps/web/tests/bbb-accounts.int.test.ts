import { prisma } from "@ronde/db";
import { readConfig } from "@ronde/module-sdk";
import { video, videoLink } from "@ronde/modules";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { encryptSecret } from "@/lib/server/secrets";
import { createMeetingRoom, meetingBbb, saveVideoAccount, testVideoAccount } from "@/lib/server/video-accounts";
import { type Fixture, meeting, workspace } from "./fixtures";

// BigBlueButton servers of the workspace, in every edition: added once by an administrator, picked by its meetings,
// which open their rooms on them; a meeting's own server is for administrators to set

let f: Fixture;
let other: Fixture;
const SUCCESS = "<response><returncode>SUCCESS</returncode></response>";

beforeAll(async () => {
  // No license: the community edition
  f = await meeting(await workspace(`bbb-${Date.now().toString(36)}`), "Weekly");
  other = await meeting(await workspace(`bbb-other-${Date.now().toString(36)}`), "Elsewhere");
});
afterEach(() => vi.unstubAllGlobals());

const server = (t: Fixture, name: string, url = "https://bbb.campus.test/bigbluebutton") =>
  prisma.videoAccount.create({
    data: { workspaceId: t.workspaceId, kind: "bbb", name, config: { url }, secret: encryptSecret(`${name}-secret`) },
  });
const videoOf = async (t: Fixture) => {
  const row = await prisma.moduleInstallation.findFirstOrThrow({ where: { meetingId: t.meetingId, moduleId: "video" } });
  return { config: readConfig(video, row.config), secret: row.secret };
};

describe("BigBlueButton servers of the workspace", () => {
  it("are added in every edition, unlike Zoom, Meet and Teams accounts", async () => {
    const { id } = await saveVideoAccount(f.ctx.ws, {
      kind: "bbb",
      name: "Campus",
      config: { url: "https://bbb.campus.test/bigbluebutton/" },
      secret: "s3cret",
    });
    const row = await prisma.videoAccount.findUniqueOrThrow({ where: { id } });
    expect(row.config).toEqual({ url: "https://bbb.campus.test/bigbluebutton" });
    expect(row.secret).not.toContain("s3cret");
    await expect(
      saveVideoAccount(f.ctx.ws, { kind: "zoom", name: "Zoom", config: { accountId: "a", clientId: "c" }, secret: "z" }),
    ).rejects.toMatchObject({ status: 403, key: "featureNotInPlan" });
    await expect(
      saveVideoAccount(f.ctx.ws, { kind: "bbb", name: "Bad", config: { url: "ftp://bbb.test" }, secret: "x" }),
    ).rejects.toThrow();
  });

  it("are checked with a call any BigBlueButton answers, signed with their secret", async () => {
    const campus = await server(f, "Checked");
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return new Response(SUCCESS);
    });
    expect(await testVideoAccount(f.ctx.ws, campus.id)).toEqual({ ok: true });
    expect(asked[0]).toMatch(/^https:\/\/bbb\.campus\.test\/bigbluebutton\/api\/getMeetings\?&checksum=[0-9a-f]{40}$/);
    vi.stubGlobal(
      "fetch",
      async () => new Response("<response><returncode>FAILED</returncode><messageKey>checksumError</messageKey></response>"),
    );
    expect(await testVideoAccount(f.ctx.ws, campus.id)).toEqual({ ok: false, error: "checksumError" });
  });

  it("are picked by a meeting, which opens its room on them with their secret", async () => {
    const campus = await server(f, "Picked");
    await runOp(f.ctx, { op: "video.configure", provider: "bbb", link: "", jitsiUrl: "", bbbAccount: campus.id, bbbUrl: "" });
    const v = await videoOf(f);
    expect(await meetingBbb(f.ctx.ws.db, v)).toEqual({ server: "https://bbb.campus.test/bigbluebutton", secret: "Picked-secret" });
    expect(videoLink(v.config, "", "/join")).toBe("/join");
    // Offered to its hosts, in the community edition too, never to the others
    expect((await loadSnapshot(f.ctx)).videoAccounts).toContainEqual({ id: campus.id, name: "Picked", kind: "bbb" });
    const participant = { ...f.ctx, can: (p: string) => p !== "meeting.configure" && f.ctx.can(p as never) };
    expect((await loadSnapshot(participant)).videoAccounts).toEqual([]);
  });

  it("of another workspace cannot be picked", async () => {
    const theirs = await server(other, "Theirs");
    await expect(
      runOp(f.ctx, { op: "video.configure", provider: "bbb", link: "", jitsiUrl: "", bbbAccount: theirs.id, bbbUrl: "" }),
    ).rejects.toMatchObject({ key: "notFound" });
    // Nor reached by a meeting that names it anyway
    expect(await meetingBbb(f.ctx.ws.db, { config: { bbbAccount: theirs.id, bbbUrl: "" }, secret: "" })).toBeNull();
  });

  it("do not create rooms the way Zoom accounts do", async () => {
    const campus = await server(f, "NoRooms");
    await expect(createMeetingRoom(f.ctx, campus.id)).rejects.toMatchObject({ status: 403 });
  });
});

describe("a meeting's own BigBlueButton server", () => {
  it("is set by an administrator; a host keeps it, but cannot point it elsewhere", async () => {
    const own = { op: "video.configure", provider: "bbb", link: "", jitsiUrl: "", bbbAccount: "" } as const;
    await runOp(f.ctx, { ...own, bbbUrl: "https://bbb.own.test/bigbluebutton", secret: "own-secret" });
    const host = { ...f.ctx, can: (p: string) => p !== "connectors.manage" && f.ctx.can(p as never) };
    // From Ronde's network: a host could otherwise make the server call any address
    await expect(runOp(host, { ...own, bbbUrl: "https://intranet.acme.test/bigbluebutton" })).rejects.toMatchObject({
      status: 403,
      key: "videoServerAdminOnly",
    });
    await runOp(host, { ...own, bbbUrl: "https://bbb.own.test/bigbluebutton" });
    expect(await meetingBbb(f.ctx.ws.db, await videoOf(f))).toEqual({ server: "https://bbb.own.test/bigbluebutton", secret: "own-secret" });
  });
});
