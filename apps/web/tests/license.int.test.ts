import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { edition, loadLicense, saveLicense } from "@/lib/server/license";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { HIDE_UPGRADE_HINTS } from "@/lib/shared/prefs";
import { type Fixture, meeting, workspace } from "./fixtures";

// License of the instance: the edition it unlocks, and the paid-plan suggestions it turns off

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-int": pair.publicKey.export({ format: "jwk" }).x });

function key(expiresAt: string) {
  const body = Buffer.from(
    JSON.stringify({
      kid: "test-int",
      id: "lic_t",
      customer: "Acme",
      edition: "enterprise",
      seats: 0,
      issuedAt: "2026-01-01T00:00:00Z",
      expiresAt,
    }),
  ).toString("base64url");
  return `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;
}

let f: Fixture;

beforeAll(async () => {
  f = await meeting(await workspace("license"), "Weekly");
  await prisma.instanceSetting.deleteMany({ where: { key: "license" } });
  await loadLicense(true);
});

afterAll(async () => {
  await saveLicense("");
});

describe("instance license", () => {
  it("is Community without a key, and suggests the paid plans to workspace administrators", async () => {
    expect(edition()).toBe("community");
    f.ctx.ws.member.role = "owner";
    expect((await loadSnapshot(f.ctx)).upgradeHints).toMatch(/\/pricing$/);
    f.ctx.ws.member.role = "member";
    expect((await loadSnapshot(f.ctx)).upgradeHints).toBeNull();
    f.ctx.ws.member.role = "owner";
  });

  it("lets an administrator hide the suggestions", async () => {
    await prisma.userPref.create({ data: { userId: f.ctx.viewer.userId, key: HIDE_UPGRADE_HINTS, value: true } });
    expect((await loadSnapshot(f.ctx)).upgradeHints).toBeNull();
    await prisma.userPref.deleteMany({ where: { userId: f.ctx.viewer.userId, key: HIDE_UPGRADE_HINTS } });
  });

  it("refuses an invalid key without replacing the saved one", async () => {
    expect((await saveLicense("ronde_lic_v1.nope.nope")).status).toBe("invalid");
    expect(await prisma.instanceSetting.count({ where: { key: "license" } })).toBe(0);
  });

  it("unlocks its edition while valid, and stops suggesting what is owned", async () => {
    expect((await saveLicense(key("2099-12-31T00:00:00Z"))).status).toBe("active");
    expect(edition()).toBe("enterprise");
    expect((await loadSnapshot(f.ctx)).upgradeHints).toBeNull();
  });

  it("falls back to Community once expired past the grace period, and when removed", async () => {
    expect((await saveLicense(key("2020-01-01T00:00:00Z"))).status).toBe("expired");
    expect(edition()).toBe("community");
    expect((await saveLicense("")).status).toBe("none");
    expect(edition()).toBe("community");
  });
});
