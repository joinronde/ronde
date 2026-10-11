import { afterEach, describe, expect, it, vi } from "vitest";
import { followsRepo, githubItemsFor } from "@/lib/server/github";

// GitHub import: the search requests, the mapping of issues and pull requests, the repository filter

const issue = (o: object) => ({
  id: 1,
  number: 12,
  title: "Login with SSO",
  state: "open",
  html_url: "https://github.com/acme/api/issues/12",
  updated_at: "2026-10-01T10:00:00Z",
  repository_url: "https://api.github.com/repos/acme/api",
  ...o,
});

afterEach(() => vi.unstubAllGlobals());

describe("followsRepo", () => {
  it("follows everything without a filter, a whole owner, or one repository", () => {
    expect(followsRepo("acme/api", "")).toBe(true);
    expect(followsRepo("acme/api", "acme")).toBe(true);
    expect(followsRepo("acme/api", "other\nACME/API")).toBe(true);
    expect(followsRepo("acme/web", "acme/api, other")).toBe(false);
    expect(followsRepo("acmeinc/api", "acme")).toBe(false);
  });
});

describe("githubItemsFor", () => {
  it("asks for assigned issues and authored pull requests, and maps their state", async () => {
    const urls: string[] = [];
    const headers: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        urls.push(decodeURIComponent(url));
        headers.push(new Headers(init.headers));
        const items = url.includes("is%3Apr")
          ? [
              issue({ id: 2, number: 13, title: "Add SAML", state: "closed", pull_request: { merged_at: "2026-10-02T00:00:00Z" } }),
              issue({ id: 3, number: 14, title: "Elsewhere", repository_url: "https://api.github.com/repos/other/x" }),
            ]
          : [issue({})];
        return new Response(JSON.stringify({ items }), { status: 200 });
      }),
    );
    const items = await githubItemsFor({ url: "https://api.github.com", token: "secret" }, "ana", "acme");
    expect(urls.some((u) => u.includes("is:issue assignee:ana updated:>="))).toBe(true);
    expect(urls.some((u) => u.includes("is:pr author:ana updated:>="))).toBe(true);
    expect(headers[0]?.get("authorization")).toBe("Bearer secret");
    expect(items.map((i) => [i.title, i.state, i.ref, i.project])).toEqual([
      ["Login with SSO", "opened", "#12", "api"],
      ["Add SAML", "merged", "#13", "api"],
    ]);
  });

  it("explains a refused token and a rate limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    await expect(githubItemsFor({ url: "https://gh.test", token: "bad" }, "bob", "")).rejects.toMatchObject({ key: "githubTokenRefused" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    await expect(githubItemsFor({ url: "https://gh.test", token: "" }, "carl", "")).rejects.toMatchObject({ key: "githubRateLimited" });
  });
});
