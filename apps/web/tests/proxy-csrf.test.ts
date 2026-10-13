import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

// A browser request coming from another site never changes anything through the API (on top of the SameSite
// session cookie); the routes other servers call keep their own checks and must still be reached

const APP = "http://localhost:3000";

/** Status of a request as the proxy answers it: 403 when it stops it, 200 when it lets it through */
async function answer(path: string, method: string, site: string | null) {
  const res = proxy(new NextRequest(`${APP}${path}`, { method, headers: site ? { "sec-fetch-site": site } : {} }));
  const blocked = res.status === 403 ? ((await res.json()) as { error: string }).error : null;
  return { status: res.status, blocked, secured: res.headers.get("x-content-type-options") };
}

describe("the API, called from another site", () => {
  it("refuses whatever changes something", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      expect(await answer("/api/w/acme/inbox", method, "cross-site")).toEqual({
        status: 403,
        blocked: "crossSiteRequest",
        secured: "nosniff",
      });
    expect((await answer("/api/w/acme/m/meeting-1/rpc", "POST", "cross-site")).status).toBe(403);
    expect((await answer("/api/account/avatar", "PUT", "cross-site")).status).toBe(403);
    expect((await answer("/api/feedback", "POST", "cross-site")).status).toBe(403);
  });

  it("refuses it from a sibling site too (the public site, another subdomain)", async () => {
    expect((await answer("/api/w/acme/logo", "DELETE", "same-site")).status).toBe(403);
  });

  it("still answers reads", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) expect((await answer("/api/w/acme/search", method, "cross-site")).status).toBe(200);
  });
});

describe("the API, called from the app itself", () => {
  it("lets changes through", async () => {
    expect((await answer("/api/w/acme/inbox", "POST", "same-origin")).status).toBe(200);
    // Typed in the address bar, or a bookmark
    expect((await answer("/api/w/acme/inbox", "POST", "none")).status).toBe(200);
  });

  it("lets through a server calling it, which sends no such header", async () => {
    expect((await answer("/api/w/acme/inbox", "POST", null)).status).toBe(200);
  });
});

describe("routes other servers call", () => {
  it("are reached from anywhere: sign-in replies, Stripe, SCIM, Slack, Teams, unsubscribe links", async () => {
    for (const path of [
      "/api/auth/sso/saml2/sp/acs/okta",
      "/api/auth/callback/google",
      "/api/billing/webhook",
      "/api/scim/v2/acme/Users",
      "/api/slack/events",
      "/api/slack/command",
      "/api/slack/interact",
      "/api/teams/messages",
      "/api/unsubscribe/weekly",
    ])
      expect({ path, ...(await answer(path, "POST", "cross-site")) }).toEqual({ path, status: 200, blocked: null, secured: "nosniff" });
  });

  it("do not open the door to their neighbours", async () => {
    // Only these routes: a sibling path sharing no listed prefix stays closed
    expect((await answer("/api/teams/package", "POST", "cross-site")).status).toBe(403);
    expect((await answer("/api/billing/portal", "POST", "cross-site")).status).toBe(403);
    // A prefix of an allowed path is not that path
    expect((await answer("/api/teams/messagesX", "POST", "cross-site")).status).toBe(403);
    expect((await answer("/api/billing/webhooks", "POST", "cross-site")).status).toBe(403);
    expect((await answer("/api/slackers", "POST", "cross-site")).status).toBe(403);
    expect((await answer("/api/w/acme/scim/v2", "POST", "cross-site")).status).toBe(403);
  });
});

describe("pages", () => {
  it("are left to the origin check Next makes on server actions", async () => {
    expect((await answer("/sign-in", "POST", "cross-site")).status).toBe(200);
  });
});
