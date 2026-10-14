import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabGroupProjects, gitlabItemsFor } from "@/lib/server/gitlab";

// GitLab import: the requests for a person's issues and merge requests, their mapping and project filter, the
// projects of the followed groups, and answers kept a moment without ever crossing from one token to another

const item = (o: object) => ({
  id: 1,
  iid: 7,
  title: "Fix the login",
  state: "opened",
  web_url: "https://gitlab.test/acme/api/-/issues/7",
  updated_at: "2026-10-01T10:00:00Z",
  references: { full: "acme/api#7" },
  ...o,
});

/** A GitLab answering issues and merge requests, recording what it was asked and with which token */
function gitlab(answer: (path: string, token: string) => unknown) {
  const calls: { path: string; token: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = decodeURIComponent(new URL(url).pathname + new URL(url).search).replace("/api/v4", "");
      const token = (new Headers(init.headers).get("authorization") ?? "").replace(/^Bearer /, "");
      calls.push({ path, token });
      return new Response(JSON.stringify(answer(path, token)), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("gitlabItemsFor", () => {
  it("asks for the assigned issues and authored merge requests, keeps the followed projects and maps their state", async () => {
    const calls = gitlab((path) =>
      path.startsWith("/merge_requests")
        ? [
            item({ id: 2, iid: 3, title: "Add SAML", state: "merged", references: { full: "acme/api!3" } }),
            item({ id: 3, iid: 4, title: "Elsewhere", references: { full: "other/x!4" } }),
          ]
        : [item({})],
    );
    const items = await gitlabItemsFor({ url: "https://gitlab.test", token: "t-1" }, "ana", "acme");
    expect(calls.map((c) => c.path.split("&updated_after")[0])).toEqual([
      "/issues?scope=all&assignee_username=ana",
      "/merge_requests?scope=all&author_username=ana",
    ]);
    expect(calls.every((c) => c.token === "t-1")).toBe(true);
    expect(items.map((i) => [i.title, i.state, i.ref, i.project, i.path])).toEqual([
      ["Fix the login", "opened", "#7", "api", "acme/api"],
      ["Add SAML", "merged", "!3", "api", "acme/api"],
    ]);
  });

  it("never serves one token's answer to another, nor one project filter's to another", async () => {
    const calls = gitlab((path, token) => (path.startsWith("/issues") ? [item({ title: `seen with ${token}` })] : []));
    const a = await gitlabItemsFor({ url: "https://gitlab.test", token: "workspace-a" }, "sam", "");
    const b = await gitlabItemsFor({ url: "https://gitlab.test", token: "workspace-b" }, "sam", "");
    expect(a[0]?.title).toBe("seen with workspace-a");
    expect(b[0]?.title).toBe("seen with workspace-b");
    // The same token and filter within a minute: answered from memory
    await gitlabItemsFor({ url: "https://gitlab.test", token: "workspace-a" }, "sam", "");
    expect(calls).toHaveLength(4);
    // Another project filter: asked again
    await gitlabItemsFor({ url: "https://gitlab.test", token: "workspace-a" }, "sam", "acme/web");
    expect(calls).toHaveLength(6);
  });

  it("explains a refused token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    await expect(gitlabItemsFor({ url: "https://gitlab.test", token: "bad" }, "zoe", "")).rejects.toMatchObject({
      key: "gitlabTokenRefused",
    });
  });
});

describe("gitlabGroupProjects", () => {
  it("reads every page of each group, leaves archived projects out and lists a project once", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const page = new URL(url).searchParams.get("page");
        const group = decodeURIComponent(new URL(url).pathname.split("/")[4] ?? "");
        const body =
          group === "acme" && page === "1"
            ? [
                { path_with_namespace: "acme/api", name: "API" },
                { path_with_namespace: "acme/old", name: "Old", archived: true },
              ]
            : group === "acme"
              ? [{ path_with_namespace: "acme/web", name: "Web" }]
              : [{ path_with_namespace: "acme/api", name: "API" }];
        return new Response(JSON.stringify(body), { headers: group === "acme" && page === "1" ? { "x-next-page": "2" } : {} });
      }),
    );
    const list = await gitlabGroupProjects({ url: "https://gitlab.test", token: "t" }, ["acme", "acme/sub"]);
    expect(list.map((p) => p.path)).toEqual(["acme/api", "acme/web"]);
  });

  it("says which group does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    await expect(gitlabGroupProjects({ url: "https://gitlab.test", token: "t" }, ["ghost"])).rejects.toMatchObject({
      key: "gitlabGroupNotFound",
      values: { group: "ghost" },
    });
  });
});
