import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";
import { AppError } from "./errors";

// Encryption of the tokens kept in the database (GitLab, Matrix): AES-256-GCM, key derived from SECRET_KEY.
// Stored format: "v1:" + base64(12-byte iv | 16-byte tag | ciphertext).

const PREFIX = "v1:";
const MIN_KEY_LENGTH = 32;

/** The key is missing or changed: the token has to be entered again */
export class SecretError extends AppError {}

const keyOf = (secret: string) => createHash("sha256").update(secret, "utf8").digest();

/** A long enough key is configured: tokens can be saved */
export const canEncrypt = (secret = env.secretKey()) => secret.length >= MIN_KEY_LENGTH;

export function encryptSecret(plain: string, secret = env.secretKey()): string {
  if (!plain) return "";
  if (!canEncrypt(secret)) throw new SecretError("secretKeyTooShort", { min: MIN_KEY_LENGTH });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decryptSecret(stored: string, secret = env.secretKey()): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX) || !canEncrypt(secret)) throw new SecretError("secretUnreadable");
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyOf(secret), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    // Key changed or value tampered with
    throw new SecretError("secretKeyChanged");
  }
}
