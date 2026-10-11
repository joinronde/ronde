import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveLicense } from "@/lib/server/license";
import { checkReports } from "@/lib/server/reports";
import { workspace } from "./fixtures";

// Insights by email: sent once per period to the workspace's administrators, only with the Team plan

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-rep": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-rep",
    id: "lic_r",
    customer: "Acme",
    edition: "team",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;

let w: Awaited<ReturnType<typeof workspace>>;
// Monday October 5, 2026, 9:00 in Paris
const MONDAY = new Date("2026-10-05T07:00:00Z");

beforeAll(async () => {
  w = await workspace(`reports-${Date.now().toString(36)}`);
  await prisma.workspace.update({
    where: { id: w.ws.id },
    data: { timezone: "Europe/Paris", settings: { reports: { frequency: "weekly", recipients: "admins", emails: [] } } },
  });
});

afterAll(async () => {
  await saveLicense("");
});

describe("scheduled reports", () => {
  it("sends nothing without the Team plan", async () => {
    await saveLicense("");
    expect(await checkReports(MONDAY)).toBe(0);
  });

  it("sends the week's report on Monday morning, once", async () => {
    await saveLicense(KEY);
    expect(await checkReports(new Date("2026-10-05T04:00:00Z"))).toBe(0);
    const sent = await checkReports(MONDAY);
    expect(sent).toBeGreaterThanOrEqual(1);
    expect(
      ((await prisma.workspace.findUniqueOrThrow({ where: { id: w.ws.id } })).settings as { reports: { lastSentFor: string } }).reports
        .lastSentFor,
    ).toBe("W:2026-10-05");
    const [a, b] = await Promise.all([checkReports(MONDAY), checkReports(MONDAY)]);
    expect(a + b).toBe(0);
  });
});
