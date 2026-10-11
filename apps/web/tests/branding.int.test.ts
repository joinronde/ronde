import { generateKeyPairSync, sign } from "node:crypto";
import { reminderEmail } from "@ronde/core/notifications";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emailBrand, workspaceBrand } from "@/lib/server/branding";
import { sniffImage } from "@/lib/server/images";
import { saveLicense } from "@/lib/server/license";
import { workspace } from "./fixtures";

// The workspace's own logo: only with the Team plan, in place of Ronde's

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-brand": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-brand",
    id: "lic_b",
    customer: "Acme",
    edition: "team",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let w: Awaited<ReturnType<typeof workspace>>;

beforeAll(async () => {
  w = await workspace(`brand-${Date.now().toString(36)}`);
  await prisma.workspaceLogo.create({ data: { workspaceId: w.ws.id, data: PNG, type: "image/png" } });
});

afterAll(async () => {
  await saveLicense("");
});

describe("workspace logo", () => {
  it("is ignored without the Team plan", async () => {
    await saveLicense("");
    expect(await workspaceBrand(w.ws.id)).toBeNull();
    expect(await emailBrand(w.ws.id)).toBeNull();
  });

  it("replaces Ronde's in emails with the Team plan", async () => {
    await saveLicense(KEY);
    const brand = await emailBrand(w.ws.id);
    expect(brand?.name).toBe(w.ws.name);
    expect(brand?.logo).toMatch(new RegExp(`/api/w/${w.ws.slug}/logo\\?v=\\d+$`));
    const mail = reminderEmail({
      settings: {
        teamName: "Weekly",
        sections: [],
        targetMin: 30,
        speakSec: 120,
        hostLabel: "",
        videoUrl: "",
      } as unknown as Parameters<typeof reminderEmail>[0]["settings"],
      locale: "en",
      date: "2030-01-07",
      time: "10:00",
      name: "Ada",
      checkInUrl: "",
      planned: [],
      actions: [],
      brand,
    });
    expect(mail.html).toContain(brand!.logo);
    expect(mail.html).not.toContain(">Ronde<");
  });

  it("accepts PNG, JPEG and WebP, never SVG", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>"))).toBeNull();
  });
});
