import "server-only";
import { createHash, randomBytes } from "node:crypto";

// SCIM provisioning tokens: shown once at creation, kept as a hash

export const hashScimToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new token: "ronde_scim_" and 40 random characters */
export function newScimToken(): { token: string; hash: string; prefix: string } {
  const token = `ronde_scim_${randomBytes(30).toString("base64url")}`;
  return { token, hash: hashScimToken(token), prefix: token.slice(0, 16) };
}
