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

  it("creates Linear issues in the team given by its key, assigned to the owner found by address", async () => {
    const calls: Call[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const q = String((JSON.parse(String(init.body)) as { query: string }).query);
      const data = q.includes("teams(")
        ? { teams: { nodes: [{ id: "3f2a9c1e-0000-4000-8000-000000000001" }] } }
        : q.includes("users(")
          ? { users: { nodes: [{ id: "user-emma" }] } }
          : { issueCreate: { success: true, issue: { id: "u1", identifier: "ENG-5", url: "https://linear.app/x/ENG-5" } } };
      return new Response(JSON.stringify({ data }));
    }) as unknown as typeof globalThis.fetch;
    const ref = await create(
      { kind: "linear", config: { team: "ENG" }, token: "lin_api", fetch },
      { ...issue, assignee: { email: "emma@acme.com" } },
    );
    expect(ref).toEqual({ key: "ENG-5", url: "https://linear.app/x/ENG-5", id: "u1" });
    const asked = calls.map(body);
    expect(asked.find((b) => String(b.query).includes("teams("))).toMatchObject({ variables: { key: "ENG" } });
    expect(asked.find((b) => String(b.query).includes("users("))).toMatchObject({ variables: { email: "emma@acme.com" } });
    expect(body(calls.at(-1)!)).toMatchObject({
      variables: { input: { teamId: "3f2a9c1e-0000-4000-8000-000000000001", title: "Get staging access", assigneeId: "user-emma" } },
    });
    // A team id is used as it is
    const direct = fake([{ data: { issueCreate: { success: true, issue: { id: "u2", identifier: "ENG-6", url: "u" } } } }]);
    await create(
      { kind: "linear", config: { team: "3f2a9c1e-0000-4000-8000-000000000002" }, token: "lin_api", fetch: direct.fetch },
      issue,
    );
    expect(direct.calls).toHaveLength(1);
  });

  it("creates Jira tickets of a type the project has, assigned when Jira lets it, with a document description", async () => {
    const jira = (types: string[], assignable = true) => {
      const calls: Call[] = [];
      const fetch = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url.includes("/user/search"))
          return new Response(
            JSON.stringify([
              { accountId: "acc-emmanuel", accountType: "atlassian", emailAddress: "emma@acme.com.au" },
              { accountId: "acc-emma", accountType: "atlassian", emailAddress: "emma@acme.com" },
            ]),
          );
        if (url.endsWith("/issue") && init.method === "POST") {
          const fields = (JSON.parse(String(init.body)) as { fields: { assignee?: unknown } }).fields;
          return fields.assignee && !assignable
            ? new Response(JSON.stringify({ errors: { assignee: "User cannot be assigned issues." } }), { status: 400 })
            : new Response(JSON.stringify({ key: "OPS-9" }));
        }
        if (url.includes("/issue/OPS-9")) return new Response(JSON.stringify({ fields: { status: { statusCategory: { key: "done" } } } }));
        return new Response(
          JSON.stringify({
            issueTypes: types.map((name) => ({ name, subtask: name === "Sub-task", hierarchyLevel: name === "Epic" ? 1 : 0 })),
          }),
        );
      }) as unknown as typeof globalThis.fetch;
      return { calls, fetch };
    };
    const access = (fetch: typeof globalThis.fetch, project: string): TrackerAccess => ({
      kind: "jira",
      config: { site: "https://acme.atlassian.net", project, email: "a@acme.com" },
      token: "tok",
      fetch,
    });
    const posted = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/issue") && c.init.method === "POST").map(body);

    const a = jira(["Epic", "Sub-task", "Story", "Task"]);
    const t = access(a.fetch, "OPS");
    expect(await create(t, { ...issue, assignee: { email: "emma@acme.com" } })).toEqual({
      key: "OPS-9",
      url: "https://acme.atlassian.net/browse/OPS-9",
    });
    expect(posted(a.calls)).toEqual([
      expect.objectContaining({
        fields: expect.objectContaining({
          project: { key: "OPS" },
          summary: "Get staging access",
          issuetype: { name: "Task" },
          assignee: { accountId: "acc-emma" },
          description: expect.objectContaining({ type: "doc" }),
        }),
      }),
    ]);
    expect((a.calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("a@acme.com:tok").toString("base64")}`,
    );
    expect(await closed(t, { key: "OPS-9", url: "" })).toBe(true);

    // No Task in this project: its first standard type; the owner cannot be assigned there: created unassigned
    const b = jira(["Epic", "Bug", "Story"], false);
    await create(access(b.fetch, "SUP"), { ...issue, assignee: { email: "emma@acme.com" } });
    expect(posted(b.calls).map((x) => x.fields as { issuetype: unknown; assignee?: unknown })).toEqual([
      { ...(posted(b.calls)[0]!.fields as object), issuetype: { name: "Bug" }, assignee: { accountId: "acc-emma" } },
      expect.not.objectContaining({ assignee: expect.anything() }),
    ]);
  });

  it("never opens a second Jira ticket after a failure that may have created the first", async () => {
    const calls: Call[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/user/search")) return new Response(JSON.stringify([{ accountId: "acc-emma", emailAddress: "emma@acme.com" }]));
      if (url.endsWith("/issue")) return new Response("upstream timeout", { status: 504 });
      return new Response(JSON.stringify({ issueTypes: [{ name: "Task" }] }));
    }) as unknown as typeof globalThis.fetch;
    const t: TrackerAccess = {
      kind: "jira",
      config: { site: "https://acme2.atlassian.net", project: "OPS", email: "a@acme.com" },
      token: "tok",
      fetch,
    };
    await expect(create(t, { ...issue, assignee: { email: "emma@acme.com" } })).rejects.toThrow("504");
    expect(calls.filter((c) => c.url.endsWith("/issue"))).toHaveLength(1);
  });

  it("asks Linear again for a team it could not find (added to it since)", async () => {
    let visible = false;
    const fetch = (async (_url: string, init: RequestInit) => {
      const q = String((JSON.parse(String(init.body)) as { query: string }).query);
      const data = q.includes("teams(")
        ? { teams: { nodes: visible ? [{ id: "3f2a9c1e-0000-4000-8000-000000000009" }] : [] } }
        : { issueCreate: { success: true, issue: { id: "u3", identifier: "OPS-1", url: "u" } } };
      return new Response(JSON.stringify({ data }));
    }) as unknown as typeof globalThis.fetch;
    const t: TrackerAccess = { kind: "linear", config: { team: "OPS" }, token: "lin_new_key", fetch };
    await expect(create(t, issue)).rejects.toThrow("team not found");
    visible = true;
    expect((await create(t, issue)).key).toBe("OPS-1");
  });

  it("says when the token is refused", async () => {
    const f = fake([{}], 401);
    expect(await check({ kind: "github", config: { repo: "acme/app" }, token: "bad", fetch: f.fetch })).toEqual({
      ok: false,
      error: "the tracker refused the token (401)",
    });
  });
});
