import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLicense, recordSeatPeak, saveLicense, seatPeak, usedSeats } from "@/lib/server/license";
import { type Fixture, meeting, workspace } from "./fixtures";

// The seats of a self-hosted license: counted as the cloud counts them (the people who took part in a meeting in
// the last 30 days), across the instance, each person once; and the highest count of the license, which its
// renewal settles. Nothing is ever blocked.

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-seats": pair.publicKey.export({ format: "jwk" }).x });

function key(id: string, seats: number) {
  const body = Buffer.from(
    JSON.stringify({
      kid: "test-seats",
      id,
      customer: "Acme",
      edition: "team",
      seats,
      issuedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2099-12-31T23:59:59Z",
    }),
  ).toString("base64url");
  return `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;
}

const DAY = 86_400_000;
let a: Fixture;
let b: Fixture;

beforeAll(async () => {
  // Two workspaces, each with a meeting held today by its host and a person of its directory
  a = await meeting(await workspace(`seats-a-${Date.now().toString(36)}`), "Weekly");
  b = await meeting(await workspace(`seats-b-${Date.now().toString(36)}`), "Weekly");
  await prisma.instanceSetting.deleteMany({ where: { key: { in: ["license", "licenseSeatPeak"] } } });
  await loadLicense(true);
});

afterAll(async () => {
  await saveLicense("");
});

describe("the seats of the instance", () => {
  it("count the people who took part in the last 30 days, across workspaces", async () => {
    expect(await usedSeats()).toBe(4);
    // A month later, nobody took part
    expect(await usedSeats(Date.now() + 31 * DAY)).toBe(0);
  });

  it("count someone once when the same account takes part in two workspaces", async () => {
    // B's host signs in with A's host account
    const aHost = await prisma.person.findUniqueOrThrow({ where: { id: a.hostPersonId } });
    await prisma.person.update({ where: { id: b.hostPersonId }, data: { userId: aHost.userId } });
    expect(await usedSeats()).toBe(3);
  });

  it("leave out the people invited who never came, and a deleted workspace", async () => {
    await prisma.person.create({ data: { workspaceId: a.workspaceId, email: `never-${Date.now()}@seats.test`, firstName: "Never" } });
    expect(await usedSeats()).toBe(3);
    await prisma.workspace.update({ where: { id: b.workspaceId }, data: { deletedAt: new Date() } });
    expect(await usedSeats()).toBe(2);
    await prisma.workspace.update({ where: { id: b.workspaceId }, data: { deletedAt: null } });
  });
});

describe("the highest count of a license", () => {
  it("is not followed without a license", async () => {
    expect(await recordSeatPeak()).toBeNull();
    expect(await seatPeak()).toBeNull();
  });

  it("starts with the license, rises with the count, and never goes down", async () => {
    expect((await saveLicense(key("lic_one", 2))).status).toBe("active");
    expect(await recordSeatPeak()).toMatchObject({ licenseId: "lic_one", peak: 3 });
    // One person less takes part: the peak stays where it was
    await prisma.session.update({ where: { id: a.sessionId }, data: { absent: [a.memberId] } });
    expect(await usedSeats()).toBe(2);
    expect(await recordSeatPeak()).toMatchObject({ peak: 3 });
    expect(await seatPeak()).toMatchObject({ licenseId: "lic_one", peak: 3 });
    // A new person takes part: the peak follows
    await prisma.session.update({ where: { id: a.sessionId }, data: { absent: [] } });
    const newcomer = await prisma.person.create({
      data: { workspaceId: b.workspaceId, email: `new-${Date.now()}@seats.test`, firstName: "New" },
    });
    const s = await prisma.session.findUniqueOrThrow({ where: { id: b.sessionId } });
    await prisma.session.update({ where: { id: b.sessionId }, data: { order: [...s.order, newcomer.id] } });
    expect(await recordSeatPeak()).toMatchObject({ peak: 4 });
  });

  it("starts over with a new license", async () => {
    await saveLicense(key("lic_two", 10));
    expect(await seatPeak()).toBeNull();
    expect(await recordSeatPeak()).toMatchObject({ licenseId: "lic_two", peak: 4 });
  });

  it("is never followed in the cloud, where each workspace pays for its own seats", async () => {
    process.env.RONDE_CLOUD = "1";
    try {
      expect(await recordSeatPeak()).toBeNull();
    } finally {
      delete process.env.RONDE_CLOUD;
    }
  });
});
