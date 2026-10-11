import { createPublicKey, verify } from "node:crypto";
import { type Edition, isEdition } from "./index";
import { LICENSE_PUBLIC_KEYS } from "./keys";

// License keys of the paid editions, self-hosted: "ronde_lic_v1.<payload>.<signature>", checked offline.
// The payload is base64url JSON; the signature is Ed25519 over "ronde_lic_v1.<payload>", by a key named in
// the payload (kid), so keys can be rotated. After expiry, a grace period keeps everything working; then the
// paid features turn read-only. Community features and the data are never blocked.

export const LICENSE_PREFIX = "ronde_lic_v1";
export const GRACE_DAYS = 14;

export interface License {
  /** Signing key */
  kid: string;
  /** License id, for support */
  id: string;
  /** Customer name, shown to the instance administrators */
  customer: string;
  edition: Exclude<Edition, "community">;
  /** Active people allowed (0: unlimited) */
  seats: number;
  /** ISO dates */
  issuedAt: string;
  expiresAt: string;
}

export type LicenseState =
  /** No key */
  | { status: "none" }
  /** Unreadable, forged, or signed by an unknown key */
  | { status: "invalid"; reason: "format" | "signature" | "unknownKey" | "payload" }
  | { status: "active"; license: License }
  /** Expired less than GRACE_DAYS ago: still fully working, administrators are warned */
  | { status: "grace"; license: License; graceEndsAt: string }
  /** Grace period over: paid features are read-only */
  | { status: "expired"; license: License };

const fromB64 = (s: string) => Buffer.from(s, "base64url");

function readPayload(raw: unknown): License | null {
  const p = raw as Partial<License> | null;
  if (!p || typeof p !== "object") return null;
  const date = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
  if (typeof p.kid !== "string" || typeof p.id !== "string" || typeof p.customer !== "string") return null;
  const edition: unknown = p.edition;
  if (!isEdition(edition) || edition === "community") return null;
  if (typeof p.seats !== "number" || !Number.isInteger(p.seats) || p.seats < 0) return null;
  if (!date(p.issuedAt) || !date(p.expiresAt)) return null;
  return { kid: p.kid, id: p.id, customer: p.customer, edition, seats: p.seats, issuedAt: p.issuedAt!, expiresAt: p.expiresAt! };
}

/** Checks a license key: signature, signing key, then the dates */
export function checkLicense(key: string | null | undefined, options: { now?: Date; keys?: Record<string, string> } = {}): LicenseState {
  const text = (key ?? "").trim();
  if (!text) return { status: "none" };
  const parts = text.split(".");
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX || !parts[1] || !parts[2]) return { status: "invalid", reason: "format" };
  let payload: License | null;
  try {
    payload = readPayload(JSON.parse(fromB64(parts[1]).toString("utf8")));
  } catch {
    return { status: "invalid", reason: "format" };
  }
  if (!payload) return { status: "invalid", reason: "payload" };
  const x = (options.keys ?? LICENSE_PUBLIC_KEYS)[payload.kid];
  if (!x) return { status: "invalid", reason: "unknownKey" };
  const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
  if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, fromB64(parts[2])))
    return { status: "invalid", reason: "signature" };
  const now = (options.now ?? new Date()).getTime();
  const expires = Date.parse(payload.expiresAt);
  if (now <= expires) return { status: "active", license: payload };
  const graceEnds = expires + GRACE_DAYS * 86_400_000;
  if (now <= graceEnds) return { status: "grace", license: payload, graceEndsAt: new Date(graceEnds).toISOString() };
  return { status: "expired", license: payload };
}

/** Edition whose features can be used: the license's while active or in grace, Community otherwise */
export const usableEdition = (state: LicenseState): Edition =>
  state.status === "active" || state.status === "grace" ? state.license.edition : "community";

/** Edition whose features can still be read: an expired license keeps its data readable */
export const readableEdition = (state: LicenseState): Edition =>
  state.status === "active" || state.status === "grace" || state.status === "expired" ? state.license.edition : "community";
