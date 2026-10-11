import { generateKeyPairSync, sign } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { aiConfig } from "@/lib/server/ai";
import { saveLicense } from "@/lib/server/license";
import { encryptSecret } from "@/lib/server/secrets";

// The AI assistant's account: the workspace key first, the instance key otherwise, only with the Team plan

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-ai": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-ai",
    id: "lic_ai",
    customer: "Acme",
    edition: "team",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;

afterAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await saveLicense("");
});

describe("AI assistant account", () => {
  it("is off without the Team plan, even when set up", async () => {
    await saveLicense("");
    process.env.ANTHROPIC_API_KEY = "sk-instance";
    expect(aiConfig({ ai: { enabled: true, model: "claude-sonnet-5-5", key: "" } }, null)).toBeNull();
  });

  it("uses the workspace key, then the instance key, and only when turned on", async () => {
    await saveLicense(KEY);
    expect(aiConfig({ ai: { enabled: false, model: "claude-sonnet-5-5", key: "" } }, null)).toBeNull();
    expect(aiConfig({ ai: { enabled: true, model: "claude-opus-5-5", key: "" } }, null)).toEqual({
      apiKey: "sk-instance",
      model: "claude-opus-5-5",
    });
    const own = aiConfig({ ai: { enabled: true, model: "unknown-model", key: encryptSecret("sk-workspace") } }, null);
    expect(own).toEqual({ apiKey: "sk-workspace", model: "claude-sonnet-5-5" });
    delete process.env.ANTHROPIC_API_KEY;
    expect(aiConfig({ ai: { enabled: true, model: "claude-sonnet-5-5", key: "" } }, null)).toBeNull();
  });
});
