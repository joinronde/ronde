import { describe, expect, it } from "vitest";
import { canEncrypt, decryptSecret, encryptSecret, SecretError } from "@/lib/server/secrets";

const KEY = "a-test-key-that-is-long-enough-0123456789";
const errorKey = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof SecretError ? e.key : "other";
  }
  return "none";
};

describe("token encryption", () => {
  it("encrypts without leaving the token readable, and reads it back", () => {
    const stored = encryptSecret("glpat-abc123", KEY);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("glpat");
    expect(decryptSecret(stored, KEY)).toBe("glpat-abc123");
  });

  it("produces a different value at each encryption", () => {
    expect(encryptSecret("glpat-abc123", KEY)).not.toBe(encryptSecret("glpat-abc123", KEY));
  });

  it("keeps the empty string for “no token”", () => {
    expect(encryptSecret("", KEY)).toBe("");
    expect(decryptSecret("", KEY)).toBe("");
  });

  it("refuses a short key, another key or a tampered value", () => {
    expect(canEncrypt("short")).toBe(false);
    expect(errorKey(() => encryptSecret("glpat-abc123", "short"))).toBe("secretKeyTooShort");
    const stored = encryptSecret("glpat-abc123", KEY);
    expect(errorKey(() => decryptSecret(stored, KEY + "x"))).toBe("secretKeyChanged");
    const altered = stored.slice(0, -4) + (stored.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(errorKey(() => decryptSecret(altered, KEY))).toBe("secretKeyChanged");
    expect(errorKey(() => decryptSecret("glpat-in-clear", KEY))).toBe("secretUnreadable");
  });
});
