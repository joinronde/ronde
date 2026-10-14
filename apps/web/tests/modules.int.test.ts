import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { type Fixture, meeting, workspace } from "./fixtures";

// A module turned off: its operations are refused, its data stays out of the browser, its settings are kept

let f: Fixture;

beforeAll(async () => {
  f = await meeting(await workspace("umbrella"), "Umbrella weekly");
});

describe("modules", () => {
  it("starts a meeting with reactions, raised hands and kudos; the other facilitation modules are added later", async () => {
    const { modules } = await loadSnapshot(f.ctx);
    expect([modules.reactions, modules.hands, modules.kudos]).toEqual([true, true, true]);
    expect([modules.icebreaker, modules.mood, modules.random, modules.sounds, modules.parking]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("runs module operations while the module is on (the default)", async () => {
    await runOp(f.ctx, { op: "kudos.add", toId: f.memberId, text: "Thanks!" });
    const snap = await loadSnapshot(f.ctx);
    expect(snap.modules.kudos).toBe(true);
    expect(snap.kudos.map((k) => k.text)).toContain("Thanks!");
  });

  it("refuses the operations of a module turned off and sends none of its data", async () => {
    await runOp(f.ctx, { op: "modules.set", moduleId: "kudos", enabled: false });
    await expect(runOp(f.ctx, { op: "kudos.add", toId: f.memberId, text: "Again" })).rejects.toMatchObject({
      key: "moduleDisabled",
      status: 403,
    });
    const snap = await loadSnapshot(f.ctx);
    expect(snap.modules.kudos).toBe(false);
    expect(snap.kudos).toEqual([]);
    // The data is kept: turning the module back on shows it again
    expect(await prisma.kudo.count({ where: { sessionId: f.sessionId } })).toBe(2);
    await runOp(f.ctx, { op: "modules.set", moduleId: "kudos", enabled: true });
    expect((await loadSnapshot(f.ctx)).kudos).toHaveLength(2);
  });

  it("keeps a module's settings while it is off", async () => {
    await runOp(f.ctx, { op: "modules.set", moduleId: "icebreaker", enabled: true });
    await runOp(f.ctx, { op: "icebreaker.configure", bank: ["Coffee or tea?", "Best book this year?"] });
    await runOp(f.ctx, { op: "modules.set", moduleId: "icebreaker", enabled: false });
    expect((await loadSnapshot(f.ctx)).meeting?.icebreaker).toBeNull();
    await runOp(f.ctx, { op: "modules.set", moduleId: "icebreaker", enabled: true });
    expect((await loadSnapshot(f.ctx)).settings.icebreakers).toEqual(["Coffee or tea?", "Best book this year?"]);
  });

  it("hides the mood and raised hands of modules turned off", async () => {
    await runOp(f.ctx, { op: "hands.add", type: "hand" });
    await runOp(f.ctx, { op: "modules.set", moduleId: "hands", enabled: false });
    await runOp(f.ctx, { op: "modules.set", moduleId: "mood", enabled: false });
    const snap = await loadSnapshot(f.ctx);
    expect(snap.interactions).toEqual([]);
    expect(snap.mood.total).toBe(0);
    expect(snap.settings.moodEnabled).toBe(false);
  });

  it("refuses unknown modules, and only lets hosts turn modules on or off", async () => {
    await expect(runOp(f.ctx, { op: "modules.set", moduleId: "nope", enabled: true })).rejects.toMatchObject({ key: "notFound" });
    const participant = { ...f.ctx, can: (p: string) => p !== "meeting.configure" && f.ctx.can(p as never) };
    await expect(runOp(participant, { op: "modules.set", moduleId: "kudos", enabled: false })).rejects.toMatchObject({ status: 403 });
  });

  it("keeps a meeting's own connection token encrypted, never in the snapshot, and uses the connection", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ username: "hana.host" }));
    try {
      await runOp(f.ctx, { op: "forge.add", kind: "gitlab", name: "Acme GitLab", token: "glpat-secret-token" });
    } finally {
      vi.unstubAllGlobals();
    }
    const row = await prisma.forgeConnection.findFirstOrThrow({ where: { meetingId: f.meetingId, name: "Acme GitLab" } });
    expect(row.secret).not.toContain("glpat-secret-token");
    const snap = await loadSnapshot(f.ctx);
    expect(JSON.stringify(snap)).not.toContain("glpat");
    expect(snap.settings.forges.connections.find((c) => c.id === row.id)).toMatchObject({
      name: "Acme GitLab",
      scope: "meeting",
      account: "hana.host",
      oauth: false,
    });
    expect(snap.settings.forges.gitlab.sources).toEqual([{ connection: row.id, groups: "", projects: "" }]);
    expect(snap.integrations.gitlab).toBe(true);
  });

  it("shows the connections, and whose accounts they read as, to the meeting's admins only", async () => {
    // The account of a connection was sent to every participant, observer and guest screen before
    const participant = {
      ...f.ctx,
      viewer: { ...f.ctx.viewer, isAdmin: false },
      can: (p: string) => p !== "meeting.configure" && f.ctx.can(p as never),
    };
    const theirs = await loadSnapshot(participant);
    expect(theirs.settings.forges.connections).toEqual([]);
    expect(JSON.stringify(theirs)).not.toContain("hana.host");
    expect(JSON.stringify(theirs)).not.toContain("Acme GitLab");
  });
});
