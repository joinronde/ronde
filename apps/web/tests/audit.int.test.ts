import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enterprise } from "@/ee-bridge";
import { AUDIT_DAYS, audit, auditSince, withinPlan } from "@/lib/server/audit";
import { saveLicense } from "@/lib/server/license";
import { runOp } from "@/lib/server/meeting/ops";
import { type Fixture, meeting, workspace } from "./fixtures";

// Audit log: written with Team or Enterprise, for configuration changes, confined to its workspace; Team shows
// the last 90 days, Enterprise the whole history

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-audit": pair.publicKey.export({ format: "jwk" }).x });
const licenseKey = (edition: "team" | "enterprise") => {
  const body = Buffer.from(
    JSON.stringify({
      kid: "test-audit",
      id: `lic_${edition}`,
      customer: "Acme",
      edition,
      seats: 0,
      issuedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2099-01-01T00:00:00Z",
    }),
  ).toString("base64url");
  return `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;
};
const KEY = licenseKey("enterprise");

let f: Fixture;
let other: Fixture;

beforeAll(async () => {
  f = await meeting(await workspace("audit"), "Weekly");
  other = await meeting(await workspace("audit-other"), "Other");
  await saveLicense("");
});

afterAll(async () => {
  await saveLicense("");
});

describe("audit log", () => {
  it("writes nothing on the Community edition", async () => {
    await runOp(f.ctx, { op: "participant.update", id: f.memberId, remind: false });
    expect(await prisma.auditLog.count({ where: { workspaceId: f.workspaceId } })).toBe(0);
  });

  it("keeps configuration changes with their author, not live interactions", async () => {
    expect((await saveLicense(KEY)).status).toBe("active");
    await runOp(f.ctx, { op: "participant.update", id: f.memberId, remind: true });
    await runOp(f.ctx, { op: "pref.set", key: "x", value: 1 });
    const rows = await prisma.auditLog.findMany({ where: { workspaceId: f.workspaceId } });
    expect(rows.map((r) => r.action)).toEqual(["participant.update"]);
    expect(rows[0]).toMatchObject({ actorUserId: f.ctx.viewer.userId, meetingId: f.meetingId, data: { id: f.memberId, remind: true } });
  });

  it("hides secrets and filters by action, person and date", async () => {
    await audit(f.ctx.ws, f.ctx.ws.db, { action: "connectors.save", targetType: "connector", data: { name: "Hook", secret: "abc" } });
    const { rows } = await enterprise.audit.list(f.ctx.ws.db, { action: "connectors." });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toEqual({ name: "Hook", secret: "[hidden]" });
    expect((await enterprise.audit.list(f.ctx.ws.db, { actor: "nobody" })).rows).toHaveLength(0);
    expect((await enterprise.audit.list(f.ctx.ws.db, { from: new Date(Date.now() + 86_400_000) })).rows).toHaveLength(0);
  });

  it("pages from the newest, and never shows another workspace's entries", async () => {
    const first = await enterprise.audit.list(f.ctx.ws.db, { limit: 1 });
    expect(first.rows[0]!.action).toBe("connectors.save");
    const second = await enterprise.audit.list(f.ctx.ws.db, { limit: 1, after: first.next! });
    expect(second.rows[0]!.action).toBe("participant.update");
    expect((await enterprise.audit.list(other.ctx.ws.db, {})).rows).toHaveLength(0);
  });

  it("shows the whole history with Enterprise, the last 90 days with Team", async () => {
    expect((await saveLicense(KEY)).status).toBe("active");
    expect(auditSince(f.ctx.ws.workspace)).toBeNull();
    expect(withinPlan(f.ctx.ws.workspace, {} as { from?: Date }).from).toBeUndefined();
    expect((await saveLicense(licenseKey("team"))).status).toBe("active");
    const since = auditSince(f.ctx.ws.workspace)!;
    expect(Math.round((Date.now() - since.getTime()) / 86_400_000)).toBe(AUDIT_DAYS);
    // An older start is held to the window (computed again, a few milliseconds later), a later one kept
    const held = withinPlan(f.ctx.ws.workspace, { from: new Date(0) }).from!;
    expect(Math.abs(held.getTime() - since.getTime())).toBeLessThan(1000);
    const later = new Date(Date.now() - 86_400_000);
    expect(withinPlan(f.ctx.ws.workspace, { from: later }).from).toEqual(later);
  });
});
