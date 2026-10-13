import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { purgeExpired } from "@/lib/server/retention";
import { type Fixture, meeting, workspace } from "./fixtures";

// The nightly purge: what is past its time goes, to the millisecond, and nothing a day younger. Time is passed
// to purgeExpired so every boundary is exact. The durations are written out: they are what the privacy policy promises.

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 13, 4, 53);
const ago = (days: number, ms = 0) => new Date(NOW - days * DAY - ms);
const run = Date.now().toString(36);
let k = 0;

/** A workspace holding a meeting with its sessions, people, actions, connectors… and a bell item and a delivery */
async function filled(name: string): Promise<Fixture> {
  const f = await meeting(await workspace(`ret-${name}-${run}`), "Weekly");
  await prisma.inboxItem.create({ data: { workspaceId: f.workspaceId, personId: f.memberId, kind: "kudo.received", href: "/" } });
  await prisma.delivery.create({
    data: { workspaceId: f.workspaceId, connectorId: f.connectorId, event: "minutes_published", key: `k-${name}-${++k}` },
  });
  await prisma.auditLog.create({ data: { workspaceId: f.workspaceId, action: "meeting.create" } });
  return f;
}

/** Rows a workspace holds across several tables */
async function rowsOf(workspaceId: string) {
  const where = { workspaceId };
  return {
    workspace: await prisma.workspace.count({ where: { id: workspaceId } }),
    members: await prisma.workspaceMember.count({ where }),
    people: await prisma.person.count({ where }),
    meetings: await prisma.meeting.count({ where }),
    sessions: await prisma.session.count({ where }),
    actions: await prisma.action.count({ where }),
    connectors: await prisma.connector.count({ where }),
    deliveries: await prisma.delivery.count({ where }),
    inbox: await prisma.inboxItem.count({ where }),
    audit: await prisma.auditLog.count({ where }),
    projects: await prisma.project.count({ where }),
  };
}

beforeAll(() => vi.stubEnv("RONDE_CLOUD", "1"));
afterAll(() => vi.unstubAllEnvs());

describe("a deleted workspace", () => {
  it("is erased with all its rows once deleted more than 30 days ago, and the others are untouched", async () => {
    const gone = await filled("gone");
    const live = await filled("live");
    await prisma.workspace.update({ where: { id: gone.workspaceId }, data: { deletedAt: ago(30, 1) } });
    const before = await rowsOf(gone.workspaceId);
    // Each table really held something: an empty one would prove nothing
    expect(Object.values(before).every((n) => n > 0)).toBe(true);
    const liveBefore = await rowsOf(live.workspaceId);

    const out = await purgeExpired(NOW);

    expect(out.workspaces).toBe(1);
    expect(Object.values(await rowsOf(gone.workspaceId)).every((n) => n === 0)).toBe(true);
    // Its people's user accounts are not the workspace's: they stay
    expect(await prisma.user.count({ where: { email: `host@ret-gone-${run}.test` } })).toBe(1);
    expect(await rowsOf(live.workspaceId)).toEqual(liveBefore);
  });

  it("is kept 29 days after its deletion, and at exactly 30 days, so support can still undo it", async () => {
    const recent = await filled("recent");
    const edge = await filled("edge");
    await prisma.workspace.update({ where: { id: recent.workspaceId }, data: { deletedAt: ago(29) } });
    await prisma.workspace.update({ where: { id: edge.workspaceId }, data: { deletedAt: ago(30) } });
    const recentBefore = await rowsOf(recent.workspaceId);
    const edgeBefore = await rowsOf(edge.workspaceId);

    expect((await purgeExpired(NOW)).workspaces).toBe(0);

    expect(await rowsOf(recent.workspaceId)).toEqual(recentBefore);
    expect(await rowsOf(edge.workspaceId)).toEqual(edgeBefore);
  });

  it("is not erased while only suspended", async () => {
    const suspended = await filled("suspended");
    await prisma.workspace.update({ where: { id: suspended.workspaceId }, data: { suspendedAt: ago(400) } });
    await purgeExpired(NOW);
    expect(await prisma.workspace.count({ where: { id: suspended.workspaceId } })).toBe(1);
  });
});

describe("the audit log", () => {
  let team: Fixture;
  let enterprise: Fixture;
  const entry = (workspaceId: string, at: Date, action: string) => prisma.auditLog.create({ data: { workspaceId, action, createdAt: at } });
  const actionsOf = async (workspaceId: string) =>
    (await prisma.auditLog.findMany({ where: { workspaceId, action: { startsWith: "t." } }, orderBy: { action: "asc" } })).map(
      (a) => a.action,
    );

  beforeAll(async () => {
    team = await filled("audit-team");
    enterprise = await filled("audit-ent");
    await prisma.workspace.update({ where: { id: team.workspaceId }, data: { plan: "team" } });
    await prisma.workspace.update({ where: { id: enterprise.workspaceId }, data: { plan: "enterprise" } });
    for (const f of [team, enterprise]) {
      await entry(f.workspaceId, ago(90, 1), "t.old");
      await entry(f.workspaceId, ago(90), "t.edge");
      await entry(f.workspaceId, ago(5), "t.recent");
    }
  });

  it("loses its entries older than 90 days, to the millisecond, on a plan showing 90 days", async () => {
    const out = await purgeExpired(NOW);
    expect(out.audit).toBe(1);
    expect(await actionsOf(team.workspaceId)).toEqual(["t.edge", "t.recent"]);
  });

  it("keeps its whole history where the plan keeps it (Enterprise)", async () => {
    await purgeExpired(NOW);
    expect(await actionsOf(enterprise.workspaceId)).toEqual(["t.edge", "t.old", "t.recent"]);
  });
});

describe("records past their time", () => {
  let f: Fixture;
  let userId: string;
  beforeAll(async () => {
    f = await filled("records");
    userId = (await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: f.workspaceId } })).userId;
  });

  it("drops deliveries after 90 days and keeps the younger ones", async () => {
    const delivery = (key: string, at: Date) =>
      prisma.delivery.create({
        data: { workspaceId: f.workspaceId, connectorId: f.connectorId, event: "minutes_published", key: `${key}-${run}`, createdAt: at },
      });
    const old = await delivery("old", ago(90, 1));
    const edge = await delivery("edge", ago(90));
    const out = await purgeExpired(NOW);
    expect(out.deliveries).toBe(1);
    expect(await prisma.delivery.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.delivery.findUnique({ where: { id: edge.id } })).not.toBeNull();
  });

  it("drops the bell's items after 180 days and keeps the younger ones", async () => {
    const item = (at: Date) =>
      prisma.inboxItem.create({
        data: { workspaceId: f.workspaceId, personId: f.memberId, kind: "kudo.received", href: "/", createdAt: at },
      });
    const old = await item(ago(180, 1));
    const edge = await item(ago(180));
    const halfYear = await item(ago(170));
    const out = await purgeExpired(NOW);
    expect(out.inbox).toBe(1);
    expect(await prisma.inboxItem.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.inboxItem.count({ where: { id: { in: [edge.id, halfYear.id] } } })).toBe(2);
  });

  it("drops sign-in sessions and links as soon as they expire", async () => {
    const session = (id: string, expiresAt: Date) =>
      prisma.authSession.create({ data: { id: `${id}-${run}`, token: `${id}-${run}`, userId, expiresAt } });
    const verification = (id: string, expiresAt: Date) =>
      prisma.verification.create({ data: { id: `${id}-${run}`, identifier: "reset", value: "v", expiresAt } });
    await session("s-expired", new Date(NOW - 1));
    await session("s-now", new Date(NOW));
    await session("s-valid", new Date(NOW + DAY));
    await verification("v-expired", new Date(NOW - 1));
    await verification("v-now", new Date(NOW));
    await verification("v-valid", new Date(NOW + 60_000));
    const out = await purgeExpired(NOW);
    expect([out.sessions, out.verifications]).toEqual([1, 1]);
    expect((await prisma.authSession.findMany({ where: { userId } })).map((s) => s.id).sort()).toEqual([`s-now-${run}`, `s-valid-${run}`]);
    expect((await prisma.verification.findMany({ where: { identifier: "reset" } })).map((v) => v.id).sort()).toEqual([
      `v-now-${run}`,
      `v-valid-${run}`,
    ]);
  });

  it("drops Stripe's event ids after a year and keeps the younger ones, which still stop Stripe's retries", async () => {
    const event = (id: string, at: Date) =>
      prisma.stripeEvent.create({ data: { id: `${id}-${run}`, type: "invoice.paid", receivedAt: at } });
    await event("evt-old", ago(365, 1));
    await event("evt-edge", ago(365));
    await event("evt-recent", ago(30));
    const out = await purgeExpired(NOW);
    expect(out.stripeEvents).toBe(1);
    expect((await prisma.stripeEvent.findMany({ orderBy: { id: "asc" } })).map((e) => e.id)).toEqual([
      `evt-edge-${run}`,
      `evt-recent-${run}`,
    ]);
  });

  it("finds nothing more to drop on the next night at the same time", async () => {
    expect(await purgeExpired(NOW)).toEqual({
      workspaces: 0,
      audit: 0,
      deliveries: 0,
      inbox: 0,
      sessions: 0,
      verifications: 0,
      stripeEvents: 0,
    });
  });
});
