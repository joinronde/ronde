// Ronde Enterprise Edition. Copyright (c) Ronde. Licensed under the Ronde Enterprise License (see ee/LICENSE).
import type { EnterpriseEdition, TicketRef, TrackerAccess, TrackerIssue } from "@ronde/editions/ee";

// Follow-up actions become tickets in Jira, Linear, GitLab or GitHub; closing the ticket closes the action

export class TrackerError extends Error {}

const trim = (url: string) => url.trim().replace(/\/+$/, "");

async function call(t: TrackerAccess, url: string, init: RequestInit & { json?: unknown } = {}): Promise<unknown> {
  const { json, ...rest } = init;
  const res = await (t.fetch ?? fetch)(url, {
    ...rest,
    headers: { accept: "application/json", ...(json ? { "content-type": "application/json" } : {}), ...auth(t), ...(rest.headers ?? {}) },
    ...(json ? { body: JSON.stringify(json) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403) throw new TrackerError(`the tracker refused the token (${res.status})`);
  if (res.status === 404) throw new TrackerError("project or repository not found");
  if (!res.ok) throw new TrackerError(`the tracker answered ${res.status}`);
  return res.status === 204 ? null : res.json();
}

function auth(t: TrackerAccess): Record<string, string> {
  switch (t.kind) {
    case "github":
      return { authorization: `Bearer ${t.token}`, "x-github-api-version": "2022-11-28" };
    case "gitlab":
      return { "private-token": t.token };
    case "linear":
      return { authorization: t.token };
    case "jira":
      return { authorization: `Basic ${Buffer.from(`${t.config.email ?? ""}:${t.token}`).toString("base64")}` };
  }
}

const gitlabProject = (t: TrackerAccess) =>
  `${trim(t.config.url || "https://gitlab.com")}/api/v4/projects/${encodeURIComponent(t.config.project ?? "")}`;

async function linear(t: TrackerAccess, query: string, variables: Record<string, unknown>) {
  const body = (await call(t, "https://api.linear.app/graphql", { method: "POST", json: { query, variables } })) as {
    data?: Record<string, unknown>;
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new TrackerError(body.errors[0]!.message);
  return body.data ?? {};
}

/** Jira descriptions are documents (ADF): one paragraph per line */
const adf = (text: string) => ({
  type: "doc",
  version: 1,
  content: text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => ({ type: "paragraph", content: [{ type: "text", text: l }] })),
});

export async function create(t: TrackerAccess, issue: TrackerIssue): Promise<TicketRef> {
  switch (t.kind) {
    case "github": {
      const r = (await call(t, `https://api.github.com/repos/${t.config.repo}/issues`, {
        method: "POST",
        json: { title: issue.title, body: issue.body, ...(issue.assignee?.github ? { assignees: [issue.assignee.github] } : {}) },
      })) as { number: number; html_url: string };
      return { key: `#${r.number}`, url: r.html_url };
    }
    case "gitlab": {
      let assignee: number | undefined;
      if (issue.assignee?.gitlab) {
        const users = (await call(
          t,
          `${trim(t.config.url || "https://gitlab.com")}/api/v4/users?username=${encodeURIComponent(issue.assignee.gitlab)}`,
        )) as {
          id: number;
        }[];
        assignee = users[0]?.id;
      }
      const r = (await call(t, `${gitlabProject(t)}/issues`, {
        method: "POST",
        json: { title: issue.title, description: issue.body, ...(assignee ? { assignee_ids: [assignee] } : {}) },
      })) as { iid: number; web_url: string };
      return { key: `#${r.iid}`, url: r.web_url };
    }
    case "linear": {
      const data = await linear(
        t,
        "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }",
        { input: { teamId: t.config.team, title: issue.title, description: issue.body } },
      );
      const created = (data.issueCreate as { issue?: { id: string; identifier: string; url: string } } | undefined)?.issue;
      if (!created) throw new TrackerError("the ticket was not created");
      return { key: created.identifier, url: created.url, id: created.id };
    }
    case "jira": {
      const site = trim(t.config.site ?? "");
      const r = (await call(t, `${site}/rest/api/3/issue`, {
        method: "POST",
        json: {
          fields: { project: { key: t.config.project }, summary: issue.title, issuetype: { name: "Task" }, description: adf(issue.body) },
        },
      })) as { key: string };
      return { key: r.key, url: `${site}/browse/${r.key}` };
    }
  }
}

export async function closed(t: TrackerAccess, ticket: TicketRef): Promise<boolean> {
  const number = ticket.key.replace(/^#/, "");
  switch (t.kind) {
    case "github":
      return ((await call(t, `https://api.github.com/repos/${t.config.repo}/issues/${number}`)) as { state: string }).state === "closed";
    case "gitlab":
      return ((await call(t, `${gitlabProject(t)}/issues/${number}`)) as { state: string }).state === "closed";
    case "linear": {
      const data = await linear(t, "query($id: String!) { issue(id: $id) { state { type } } }", { id: ticket.id ?? ticket.key });
      const type = (data.issue as { state?: { type?: string } } | undefined)?.state?.type;
      return type === "completed" || type === "canceled";
    }
    case "jira": {
      const r = (await call(t, `${trim(t.config.site ?? "")}/rest/api/3/issue/${ticket.key}?fields=status`)) as {
        fields?: { status?: { statusCategory?: { key?: string } } };
      };
      return r.fields?.status?.statusCategory?.key === "done";
    }
  }
}

export async function test(t: TrackerAccess): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    switch (t.kind) {
      case "github":
        await call(t, `https://api.github.com/repos/${t.config.repo}`);
        break;
      case "gitlab":
        await call(t, gitlabProject(t));
        break;
      case "linear": {
        const data = await linear(t, "query($id: String!) { team(id: $id) { id } }", { id: t.config.team });
        if (!data.team) throw new TrackerError("team not found");
        break;
      }
      case "jira":
        await call(t, `${trim(t.config.site ?? "")}/rest/api/3/project/${encodeURIComponent(t.config.project ?? "")}`);
        break;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const trackers: EnterpriseEdition["trackers"] = { create, closed, test };
