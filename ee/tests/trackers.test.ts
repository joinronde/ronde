import type { TrackerAccess } from "@ronde/editions/ee";
import { describe, expect, it } from "vitest";
import { test as check, closed, create } from "../src/trackers";

// Tickets from follow-up actions: what each tracker receives, and how a closed ticket is recognised

type Call = { url: string; init: RequestInit };
const fake = (answers: unknown[], status = 200) => {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answers[calls.length - 1] ?? {}), { status });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
};
const body = (c: Call) => JSON.parse(String(c.init.body)) as Record<string, unknown>;
const issue = { title: "Get staging access", body: "From: Weekly, October 5", assignee: { github: "emma", gitlab: "emma" } };

describe("issue trackers", () => {
  it("opens a GitHub issue assigned to the owner, and reads its state", async () => {
    const f = fake([{ number: 34, html_url: "https://github.com/acme/app/issues/34" }, { state: "closed" }]);
    const t: TrackerAccess = { kind: "github", config: { repo: "acme/app" }, token: "ghp_x", fetch: f.fetch };
    expect(await create(t, issue)).toEqual({ key: "#34", url: "https://github.com/acme/app/issues/34" });
    expect(f.calls[0]!.url).toBe("https://api.github.com/repos/acme/app/issues");
    expect(body(f.calls[0]!)).toMatchObject({ title: "Get staging access", assignees: ["emma"] });
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer ghp_x");
    expect(await closed(t, { key: "#34", url: "" })).toBe(true);
    expect(f.calls[1]!.url).toBe("https://api.github.com/repos/acme/app/issues/34");
  });

  it("finds the GitLab user before assigning the issue", async () => {
    const f = fake([[{ id: 7 }], { iid: 12, web_url: "https://gitlab.example.org/acme/app/-/issues/12" }]);
    const t: TrackerAccess = {
      kind: "gitlab",
      config: { url: "https://gitlab.example.org/", project: "acme/app" },
      token: "glpat",
      fetch: f.fetch,
    };
    expect((await create(t, issue)).key).toBe("#12");
    expect(f.calls[1]!.url).toBe("https://gitlab.example.org/api/v4/projects/acme%2Fapp/issues");
    expect(body(f.calls[1]!)).toMatchObject({ assignee_ids: [7] });
  });

  it("creates Linear issues through GraphQL, and Jira tasks with a document description", async () => {
    const lin = fake([
      { data: { issueCreate: { success: true, issue: { id: "u1", identifier: "ENG-5", url: "https://linear.app/x/ENG-5" } } } },
    ]);
    const ref = await create({ kind: "linear", config: { team: "team-1" }, token: "lin_api", fetch: lin.fetch }, issue);
    expect(ref).toEqual({ key: "ENG-5", url: "https://linear.app/x/ENG-5", id: "u1" });
    expect(body(lin.calls[0]!)).toMatchObject({ variables: { input: { teamId: "team-1", title: "Get staging access" } } });

    const jira = fake([{ key: "OPS-9" }, { fields: { status: { statusCategory: { key: "done" } } } }]);
    const t: TrackerAccess = {
      kind: "jira",
      config: { site: "https://acme.atlassian.net", project: "OPS", email: "a@acme.com" },
      token: "tok",
      fetch: jira.fetch,
    };
    expect(await create(t, issue)).toEqual({ key: "OPS-9", url: "https://acme.atlassian.net/browse/OPS-9" });
    expect(body(jira.calls[0]!)).toMatchObject({
      fields: { project: { key: "OPS" }, summary: "Get staging access", description: { type: "doc" } },
    });
    expect((jira.calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("a@acme.com:tok").toString("base64")}`,
    );
    expect(await closed(t, { key: "OPS-9", url: "" })).toBe(true);
  });

  it("says when the token is refused", async () => {
    const f = fake([{}], 401);
    expect(await check({ kind: "github", config: { repo: "acme/app" }, token: "bad", fetch: f.fetch })).toEqual({
      ok: false,
      error: "the tracker refused the token (401)",
    });
  });
});
