import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signupAllowed } from "@/lib/server/auth";
import { instanceSettings, saveInstanceSettings } from "@/lib/server/instance";

// Instance settings: the environment gives the starting values, what an administrator saves wins

beforeAll(async () => {
  vi.stubEnv("SIGNUP_POLICY", "invite-only");
  vi.stubEnv("DEFAULT_LOCALE", "en");
  // Someone already has an account: the first account is always allowed, the next ones follow the policy
  await prisma.user.create({ data: { id: crypto.randomUUID(), email: "admin@instance.test", name: "Admin", instanceRole: "admin" } });
});

describe("instance settings", () => {
  it("starts from the environment", async () => {
    expect(await instanceSettings()).toEqual({ defaultLocale: "en", signupPolicy: "invite-only", signupDomains: [] });
    expect(await signupAllowed("someone@example.org")).toBe(false);
  });

  it("lets administrators open sign-up to email domains and change the default language", async () => {
    await saveInstanceSettings({
      defaultLocale: "fr",
      signupPolicy: "domains",
      signupDomains: [" @Example.org", "not a domain", "corp.example.com"],
    });
    expect(await instanceSettings()).toEqual({
      defaultLocale: "fr",
      signupPolicy: "domains",
      signupDomains: ["example.org", "corp.example.com"],
    });
    expect(await signupAllowed("Someone@EXAMPLE.org")).toBe(true);
    expect(await signupAllowed("someone@other.org")).toBe(false);
  });

  it("lets anyone create an account in the cloud, whatever an administrator saved", async () => {
    vi.stubEnv("RONDE_CLOUD", "1");
    expect((await instanceSettings()).signupPolicy).toBe("open");
    expect(await signupAllowed("someone@other.org")).toBe(true);
    vi.unstubAllEnvs();
  });
});
