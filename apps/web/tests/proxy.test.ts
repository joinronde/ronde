import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The cookie telling the public site that this browser is signed in to the app

const SESSION = "ronde.session_token=abc";

async function visit(env: { app: string; site?: string }, cookie = "") {
  vi.resetModules();
  vi.stubEnv("APP_URL", env.app);
  vi.stubEnv("RONDE_SITE_URL", env.site ?? "");
  const { proxy } = await import("@/proxy");
  const res = proxy(new NextRequest(`${env.app}/w/acme`, { headers: cookie ? { cookie } : {} }));
  return res.headers.getSetCookie().find((c) => c.startsWith("ronde_in_")) ?? null;
}

afterEach(() => vi.unstubAllEnvs());

describe("signed-in hint for the public site", () => {
  it("is set on the domain the app and the site share, named after the app", async () => {
    const set = await visit({ app: "https://staging-app.joinronde.com", site: "https://staging.joinronde.com" }, SESSION);
    expect(set).toMatch(/^ronde_in_staging_app_joinronde_com=1;/);
    expect(set).toMatch(/Domain=joinronde\.com/i);
    expect(set).toMatch(/Secure/i);
    expect(set).not.toMatch(/HttpOnly/i);
  });

  it("is left alone while it is there, and removed once the session cookie is gone", async () => {
    const app = { app: "https://app.joinronde.com" };
    expect(await visit(app, `${SESSION}; ronde_in_app_joinronde_com=1`)).toBeNull();
    expect(await visit(app, "ronde_in_app_joinronde_com=1")).toMatch(/^ronde_in_app_joinronde_com=;.*Max-Age=0/i);
    expect(await visit(app)).toBeNull();
  });

  it("is never set when the app and the site share no domain (a self-hosted instance)", async () => {
    expect(await visit({ app: "https://ronde.acme.org" }, SESSION)).toBeNull();
    expect(await visit({ app: "http://localhost:3200" }, SESSION)).toBeNull();
  });
});
