import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkLicense, LICENSE_PREFIX, type License, readableEdition, usableEdition } from "../src/license";

// License keys: test vectors signed with a throwaway key (valid, expired, forged, unknown key, grace period)

const pair = generateKeyPairSync("ed25519");
const other = generateKeyPairSync("ed25519");
const keys = { "test-1": pair.publicKey.export({ format: "jwk" }).x! };

const base: License = {
  kid: "test-1",
  id: "lic_42",
  customer: "Acme",
  edition: "enterprise",
  seats: 50,
  issuedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-12-31T23:59:59.000Z",
};

function make(payload: object, key = pair.privateKey) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(null, Buffer.from(`${LICENSE_PREFIX}.${body}`), key).toString("base64url");
  return `${LICENSE_PREFIX}.${body}.${signature}`;
}

const at = (iso: string) => ({ keys, now: new Date(iso) });

describe("checkLicense", () => {
  it("accepts a valid key and unlocks its edition", () => {
    const state = checkLicense(make(base), at("2026-06-01T00:00:00Z"));
    expect(state).toEqual({ status: "active", license: base });
    expect(usableEdition(state)).toBe("enterprise");
  });

  it("keeps working for 14 days after expiry, then turns read-only", () => {
    const grace = checkLicense(make(base), at("2027-01-10T00:00:00Z"));
    expect(grace).toMatchObject({ status: "grace", graceEndsAt: "2027-01-14T23:59:59.000Z" });
    expect(usableEdition(grace)).toBe("enterprise");
    const expired = checkLicense(make(base), at("2027-01-15T00:00:00Z"));
    expect(expired.status).toBe("expired");
    expect(usableEdition(expired)).toBe("community");
    expect(readableEdition(expired)).toBe("enterprise");
  });

  it("refuses a forged key: changed payload or another signer", () => {
    const [prefix, , sig] = make(base).split(".");
    const forged = `${prefix}.${Buffer.from(JSON.stringify({ ...base, seats: 5000 })).toString("base64url")}.${sig}`;
    expect(checkLicense(forged, at("2026-06-01T00:00:00Z"))).toEqual({ status: "invalid", reason: "signature" });
    expect(checkLicense(make(base, other.privateKey), at("2026-06-01T00:00:00Z"))).toEqual({ status: "invalid", reason: "signature" });
  });

  it("refuses a key signed by an unknown key id", () => {
    expect(checkLicense(make({ ...base, kid: "retired-0" }), at("2026-06-01T00:00:00Z"))).toEqual({
      status: "invalid",
      reason: "unknownKey",
    });
  });

  it("refuses what is not a license key", () => {
    expect(checkLicense("", at("2026-06-01T00:00:00Z"))).toEqual({ status: "none" });
    expect(checkLicense("ronde_lic_v1.abc", at("2026-06-01T00:00:00Z"))).toEqual({ status: "invalid", reason: "format" });
    expect(checkLicense("ronde_lic_v1.@@@.x", at("2026-06-01T00:00:00Z"))).toEqual({ status: "invalid", reason: "format" });
    expect(checkLicense(make({ ...base, edition: "community" }), at("2026-06-01T00:00:00Z"))).toEqual({
      status: "invalid",
      reason: "payload",
    });
    expect(usableEdition({ status: "invalid", reason: "format" })).toBe("community");
  });
});
