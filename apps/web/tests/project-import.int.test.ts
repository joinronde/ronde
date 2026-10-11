import { generateKeyPairSync, sign } from "node:crypto";
import { can } from "@ronde/core/permissions";
import { prisma } from "@ronde/db";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@/lib/server/authz";
import { saveLicense } from "@/lib/server/license";
import { followedProjects, toProjectDTO } from "@/lib/server/meeting/projects";
import { configOf, importProjects, previewImport, syncProject, syncProjects, unlinkSource } from "@/lib/server/project-import";
import { setProjectLogo } from "@/lib/server/project-logo";
import { adfToMarkdown, readSourceOf } from "@/lib/server/project-sources";
import { deleteTracker, saveTracker } from "@/lib/server/trackers";
import { type Fixture, meeting, workspace } from "./fixtures";

// Projects imported from GitHub, GitLab, Jira and Linear: picked once in every edition, then (Team, through a
// saved issue tracker) kept in sync with the tool every hour. The tools are fakes here.

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-imp": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-imp",
    id: "lic_imp",
    customer: "Acme",
    edition: "team",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;

/** What the tools hold, changed by the tests */
let milestones: Record<string, unknown>[] = [];
let repos: Record<string, unknown>[] = [];
let glProjects: Record<string, unknown>[] = [];
let linearProjects: Record<string, unknown>[] = [];
let epics: Record<string, unknown>[] = [];
/** An image the tools serve as logos */
let png: Buffer;
/** How the tools answer: normally, refusing the token, asking to slow down, or failing to count issues */
let mood: "fine" | "refuse" | "throttle" | "countsDown" = "fine";
const asked: { url: string; auth: string; body: string }[] = [];

const byId = (list: Record<string, unknown>[], id: string, field = "id") => {
  const found = list.find((x) => String(x[field]) === id);
  return found ? Response.json(found) : new Response("{}", { status: 404 });
};

const tools = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      const sent = String(init.body ?? "");
      asked.push({ url, auth: headers.authorization ?? headers["private-token"] ?? "", body: sent });
      if (mood === "refuse") return new Response("{}", { status: 401 });
      if (mood === "throttle") return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
      let m: RegExpExecArray | null;
      // Images: an organization's avatar on GitHub, a Jira project's (read with the token)
      if (url.startsWith("https://avatars.githubusercontent.com/"))
        return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
      if (url.startsWith("https://acme.atlassian.net/rest/api/3/universal_avatar/"))
        return headers.authorization
          ? new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } })
          : new Response("{}", { status: 401 });
      if (url === "https://acme.atlassian.net/rest/api/3/project/OPS")
        return Response.json({
          avatarUrls: { "48x48": "https://acme.atlassian.net/rest/api/3/universal_avatar/view/type/project/avatar/10400?size=large" },
        });
      // GitHub: an organization's repositories ("acme"), a person's ("solo"), a repository's milestones
      if (url.startsWith("https://api.github.com/orgs/acme/repos")) return Response.json(repos);
      if (url.startsWith("https://api.github.com/users/solo/repos")) return Response.json(repos);
      m = /^https:\/\/api\.github\.com\/repositories\/(\d+)$/.exec(url);
      if (m) return byId(repos, m[1]!);
      m = /^https:\/\/api\.github\.com\/repos\/acme\/app\/milestones\/(\d+)$/.exec(url);
      if (m) return byId(milestones, m[1]!, "number");
      if (url.startsWith("https://api.github.com/repos/acme/app/milestones")) return Response.json(milestones.slice(0, 100));
      // GitLab: a group's projects, a project's milestones and their issues counted
      if (url.startsWith("https://gitlab.acme.test/api/v4/groups/acme/projects")) return Response.json(glProjects);
      m = /^https:\/\/gitlab\.acme\.test\/api\/v4\/projects\/(\d+)$/.exec(url);
      if (m) return byId(glProjects, m[1]!);
      if (url.includes("/issues_statistics")) {
        if (mood === "countsDown") return new Response("{}", { status: 500 });
        return Response.json({ statistics: { counts: { all: 8, closed: 6 } } });
      }
      m = /^https:\/\/gitlab\.acme\.test\/api\/v4\/projects\/acme%2Fapp\/milestones\/(\d+)$/.exec(url);
      if (m) return byId(milestones, m[1]!);
      if (url.startsWith("https://gitlab.acme.test/api/v4/projects/acme%2Fapp/milestones")) return Response.json(milestones);
      // Jira: the epics of a project, one epic, its child issues counted
      if (url === "https://acme.atlassian.net/rest/api/3/search/jql") return Response.json({ issues: epics });
      if (url === "https://acme.atlassian.net/rest/api/3/search/approximate-count") {
        if (mood === "countsDown") return new Response("{}", { status: 500 });
        return Response.json({ count: JSON.parse(sent).jql.includes("Done") ? 3 : 4 });
      }
      m = /\/rest\/api\/3\/issue\/(\d+)/.exec(url);
      if (m) return byId(epics, m[1]!);
      if (url === "https://api.linear.app/graphql") {
        const { query, variables } = JSON.parse(sent) as { query: string; variables?: { ids?: string[] } };
        const nodes = variables?.ids ? linearProjects.filter((p) => variables.ids!.includes(p.id as string)) : linearProjects;
        // A saved tracker names its team: the projects of that team
        return Response.json({ data: query.includes("team(") ? { team: { projects: { nodes } } } : { projects: { nodes } } });
      }
      return new Response("{}", { status: 404 });
    }),
  );

const milestone = (number: number, title: string, extra: Record<string, unknown> = {}) => ({
  number,
  id: 1000 + number,
  title,
  description: "",
  state: "open",
  due_on: "2026-12-01T08:00:00Z",
  html_url: `https://github.com/acme/app/milestone/${number}`,
  web_url: `https://gitlab.acme.test/acme/app/-/milestones/${number}`,
  open_issues: 3,
  closed_issues: 1,
  ...extra,
});

const repo = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  full_name: `acme/${name}`,
  description: null,
  html_url: `https://github.com/acme/${name}`,
  owner: { login: "acme", avatar_url: "https://avatars.githubusercontent.com/u/9?v=4" },
  archived: false,
  fork: false,
  ...extra,
});

let f: Fixture;
let ws: WorkspaceContext;
/** The same workspace as a plain member */
let member: WorkspaceContext;
let memberEmail: string;
const ids = (items: { id: string }[]) => items.map((i) => i.id);
const row = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });
const sourceOf = async (id: string) => readSourceOf((await row(id)).source);
/** As if the tool was last read long ago: the next hourly run reads it again */
const age = (id: string, hours: number) =>
  prisma.project.update({ where: { id }, data: { syncedAt: new Date(Date.now() - hours * 3_600_000) } });

/** A project as a meeting would show it (the meeting follows it for the occasion) */
async function followedProjectOf(projectId: string) {
  await prisma.meetingProject.upsert({
    where: { meetingId_projectId: { meetingId: f.meetingId, projectId } },
    create: { workspaceId: f.workspaceId, meetingId: f.meetingId, projectId, position: 50 },
    update: {},
  });
  return (await followedProjects(ws.db, f.meetingId)).find((p) => p.id === projectId)!;
}

beforeAll(async () => {
  png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#f08020" } })
    .png()
    .toBuffer();
  await saveLicense("");
  f = await meeting(await workspace(`imp-${Date.now().toString(36)}`), "Platform sync");
  ws = f.ctx.ws;
  const principal = { ...ws.principal, personId: f.memberId, workspaceRole: "member" as const };
  member = { ...ws, member: { ...ws.member, personId: f.memberId, role: "member" }, principal, can: (p) => can(principal, p) };
  memberEmail = (await prisma.person.findUniqueOrThrow({ where: { id: f.memberId } })).email;
});
beforeEach(() => {
  asked.length = 0;
  mood = "fine";
  tools();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await saveLicense("");
});

describe("where projects come from", () => {
  it("reads the organization, repository, group, project or site the person typed", () => {
    const typed = (address: string, project = "", email = "") => ({ address, project, email });
    expect(configOf("github", "milestones", typed("https://github.com/acme/app/milestones"))).toEqual({
      url: "https://github.com",
      repo: "acme/app",
    });
    expect(configOf("github", "milestones", typed("acme/app"))).toEqual({ url: "https://github.com", repo: "acme/app" });
    // The public service whichever way it is written
    expect(configOf("github", "repos", typed("www.github.com/acme"))).toEqual({ url: "https://github.com", owner: "acme" });
    expect(configOf("github", "repos", typed("http://github.com/acme"))).toEqual({ url: "https://github.com", owner: "acme" });
    expect(configOf("github", "repos", typed("acme"))).toEqual({ url: "https://github.com", owner: "acme" });
    expect(configOf("github", "repos", typed("https://git.acme.test/platform"))).toEqual({
      url: "https://git.acme.test",
      owner: "platform",
    });
    expect(configOf("gitlab", "milestones", typed("https://gitlab.acme.test/acme/app/-/milestones"))).toEqual({
      url: "https://gitlab.acme.test",
      project: "acme/app",
    });
    expect(configOf("gitlab", "projects", typed("gitlab.com/acme/platform"))).toEqual({
      url: "https://gitlab.com",
      group: "acme/platform",
    });
    expect(configOf("jira", "epics", typed("acme.atlassian.net", "ops", "me@acme.test"))).toEqual({
      site: "https://acme.atlassian.net",
      project: "OPS",
      email: "me@acme.test",
    });
    // Atlassian Cloud only in https: the token never goes out in clear
    expect(configOf("jira", "epics", typed("http://acme.atlassian.net", "ops", "me@acme.test"))).toMatchObject({
      site: "https://acme.atlassian.net",
    });
    expect(configOf("github", "milestones", typed("not a repo"))).toBeNull();
    expect(configOf("github", "milestones", typed("acme"))).toBeNull();
    expect(configOf("gitlab", "milestones", typed("https://gitlab.acme.test/acme"))).toBeNull();
    expect(configOf("jira", "epics", typed("https://acme.atlassian.net", "", "me@acme.test"))).toBeNull();
  });

  it("turns a Jira description back into Markdown", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Goal" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            { type: "text", text: "the spec", marks: [{ type: "link", attrs: { href: "https://x.test" } }] },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }] }] },
      ],
    };
    expect(adfToMarkdown(doc)).toBe("## Goal\n\nSee [the spec](https://x.test)\n\n- One");
  });
});

describe("importing projects (every edition)", () => {
  it("imports the repositories of a GitHub organization, or of a person's account, forks left out", async () => {
    repos = [
      repo(501, "billing", { description: "Invoices and payments", homepage: "https://billing.acme.test", topics: ["payments", "api"] }),
      repo(502, "legacy-site", { archived: true }),
      repo(503, "react", { description: "Our fork", fork: true }),
    ];
    const preview = await previewImport(ws, { kind: "github", address: "https://github.com/acme" });
    // Repositories are what GitHub offers first; without a token, the public ones only
    expect(preview).toMatchObject({ what: "repos", where: "acme", partial: "public" });
    expect(preview.items.map((i) => [i.name, i.status, i.summary])).toEqual([
      ["billing", null, "Invoices and payments"],
      ["legacy-site", "done", ""],
    ]);
    expect((await previewImport(ws, { kind: "github", address: "solo" })).items).toHaveLength(2);
    expect(asked.some((a) => a.url.includes("/users/solo/repos"))).toBe(true);

    asked.length = 0;
    const { created } = await importProjects(ws, { kind: "github", address: "acme" }, { ids: ids(preview.items) });
    // A repository comes as the list gave it: no reading it again
    expect(asked.filter((a) => a.url.includes("/repositories/"))).toHaveLength(0);
    // Its organization's avatar is its logo, as a 256 px square, read once for both repositories
    expect(asked.filter((a) => a.url.startsWith("https://avatars.githubusercontent.com/u/9"))).toHaveLength(1);
    const logos = await prisma.projectLogo.findMany({ where: { projectId: { in: created.map((c) => c.id) } } });
    expect(logos).toHaveLength(2);
    expect(logos[0]).toMatchObject({ type: "image/webp" });
    expect((await sharp(logos[0]!.data).metadata()).width).toBe(256);
    const p = await row(created[0]!.id);
    expect(p).toMatchObject({
      name: "billing",
      status: "active",
      summary: "Invoices and payments",
      targetDate: null,
      sourceTrackerId: null,
    });
    // Its description, website and topics make the project's description
    expect(p.description).toBe("Invoices and payments\n\n🌐 https://billing.acme.test/\n\n`payments` · `api`");
    expect(await sourceOf(p.id)).toMatchObject({
      what: "repos",
      key: "acme/billing",
      url: "https://github.com/acme/billing",
      progress: null,
    });
  });

  it("lists the milestones of a repository, named after it, then imports the ones picked, once", async () => {
    milestones = [
      milestone(1, "v1.0", { state: "closed", description: "The first release" }),
      milestone(2, "v2.0", { description: "Billing\n\nInvoices and the customer portal." }),
      milestone(3, "v3.0", { open_issues: 0, closed_issues: 0, due_on: null }),
    ];
    const source = { kind: "github" as const, what: "milestones" as const, address: "acme/app" };
    const preview = await previewImport(ws, source);
    expect(preview).toMatchObject({ kind: "github", what: "milestones", where: "acme/app", more: false, sync: false });
    expect(preview.items.map((i) => [i.name, i.status, i.targetDate, i.progress])).toEqual([
      ["app · v1.0", "done", "2026-12-01", 0.25],
      ["app · v2.0", "active", "2026-12-01", 0.25],
      ["app · v3.0", "active", null, null],
    ]);
    // No token: GitHub is asked anonymously
    expect(asked[0]!.auth).toBe("");

    const { created } = await importProjects(ws, source, { ids: ids(preview.items).slice(0, 2) });
    const [v1, v2] = await Promise.all(created.map((c) => row(c.id)));
    // The tool's description is the description; its first line, the summary
    expect(v1).toMatchObject({
      name: "app · v1.0",
      status: "done",
      summary: "The first release",
      description: "The first release",
      targetDate: "2026-12-01",
    });
    expect(v2).toMatchObject({ name: "app · v2.0", summary: "Billing", description: "Billing\n\nInvoices and the customer portal." });
    expect(v2!.sourceKey).toBe("github:https://github.com#milestone:1002");
    expect(await sourceOf(v2!.id)).toMatchObject({
      what: "milestones",
      key: "v2.0",
      config: { url: "https://github.com", repo: "acme/app" },
    });

    // Asked again: the two are in the portfolio, and importing everything brings the third only
    const again = await previewImport(ws, source);
    expect(again.items.map((i) => i.imported)).toEqual([{ slug: v1!.slug }, { slug: v2!.slug }, null]);
    expect((await importProjects(ws, source, { ids: ids(again.items) })).created).toHaveLength(1);
    // Imported once: no progress shown as current (nobody keeps it up to date), its repository's issues in meetings
    const dto = toProjectDTO(await followedProjectOf(v2!.id));
    expect(dto.progress).toBeNull();
    expect(dto.repos.github).toEqual(["acme/app"]);
  });

  it("imports the projects of a GitLab group, and counts a GitLab milestone's issues", async () => {
    glProjects = [
      {
        id: 71,
        name: "API",
        path_with_namespace: "acme/platform/api",
        description: "The public API",
        web_url: "https://gitlab.acme.test/acme/platform/api",
        archived: false,
      },
    ];
    const group = { kind: "gitlab" as const, address: "https://gitlab.acme.test/acme" };
    const preview = await previewImport(ws, group);
    expect(preview).toMatchObject({ what: "projects", where: "acme" });
    const { created } = await importProjects(ws, group, { ids: ids(preview.items) });
    expect(await row(created[0]!.id)).toMatchObject({ name: "API", summary: "The public API", status: "active" });
    expect(toProjectDTO(await followedProjectOf(created[0]!.id)).repos.gitlab).toEqual(["acme/platform/api"]);

    milestones = [milestone(7, "Q4 roadmap", { state: "active", start_date: "2026-10-01", due_date: "2026-12-20" })];
    asked.length = 0;
    const source = { kind: "gitlab" as const, what: "milestones" as const, address: "https://gitlab.acme.test/acme/app", token: "glpat-x" };
    const ms = await previewImport(ws, source);
    expect(ms.items[0]).toMatchObject({ name: "app · Q4 roadmap", status: "active", progress: null });
    expect(asked[0]!.auth).toBe("glpat-x");
    const imported = await importProjects(ws, source, { ids: ids(ms.items) });
    expect(await row(imported.created[0]!.id)).toMatchObject({ startDate: "2026-10-01", targetDate: "2026-12-20" });
    expect(await sourceOf(imported.created[0]!.id)).toMatchObject({ done: 6, total: 8, progress: 0.75 });
  });

  it("imports Jira epics with their child issues counted and their assignee as lead", async () => {
    epics = [
      {
        id: "10042",
        key: "OPS-42",
        fields: {
          summary: "Data centre move",
          description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Out of the old racks" }] }] },
          status: { statusCategory: { key: "indeterminate" } },
          duedate: "2027-01-15",
          assignee: { emailAddress: memberEmail },
        },
      },
    ];
    const source = { kind: "jira" as const, address: "acme.atlassian.net", project: "ops", email: "me@acme.test", token: "atl" };
    const preview = await previewImport(ws, source);
    expect(JSON.parse(asked[0]!.body).jql).toBe('project = "OPS" AND issuetype = Epic ORDER BY created DESC');
    expect(asked[0]!.auth).toBe(`Basic ${Buffer.from("me@acme.test:atl").toString("base64")}`);
    const { created } = await importProjects(ws, source, { ids: ids(preview.items) });
    const p = await row(created[0]!.id);
    expect(p).toMatchObject({ name: "Data centre move", status: "active", summary: "Out of the old racks", leadId: f.memberId });
    expect(await sourceOf(p.id)).toMatchObject({ key: "OPS-42", url: "https://acme.atlassian.net/browse/OPS-42", done: 3, total: 4 });
    // The Jira project's avatar, the largest one, as PNG, read with the token
    const avatar = asked.find((a) => a.url.includes("/universal_avatar/"))!;
    expect(avatar.url).toContain("size=xxlarge");
    expect(avatar.url).toContain("format=png");
    expect(await prisma.projectLogo.count({ where: { projectId: p.id } })).toBe(1);
  });

  it("says what went wrong in the person's words", async () => {
    mood = "refuse";
    await expect(
      previewImport(ws, { kind: "gitlab", what: "milestones", address: "https://gitlab.acme.test/acme/app", token: "x" }),
    ).rejects.toMatchObject({ key: "sourceRefused", values: { tool: "GitLab" } });
    // GitHub's limit for requests without a token is not a refused token
    mood = "throttle";
    await expect(previewImport(ws, { kind: "github", address: "acme" })).rejects.toMatchObject({ key: "sourceRateLimited" });
    mood = "fine";
    await expect(previewImport(ws, { kind: "github", what: "milestones", address: "nope" })).rejects.toMatchObject({
      key: "sourceAddressInvalid",
    });
    await expect(previewImport(ws, { kind: "linear" })).rejects.toMatchObject({ key: "sourceTokenRequired" });
    // A token that could not travel in a header is refused before anything is sent, in the person's words
    await expect(previewImport(ws, { kind: "linear", token: "lin\napi" })).rejects.toMatchObject({ key: "tokenInvalid" });
    expect(asked).toHaveLength(2);
    // One pasted with its "Bearer" goes as it is
    linearProjects = [];
    await previewImport(ws, { kind: "linear", token: "Bearer lin_oauth_x" });
    expect(asked.at(-1)!.auth).toBe("Bearer lin_oauth_x");
  });

  it("keeps another server for the workspace's administrators, and links from the tool to the tool", async () => {
    repos = [repo(511, "tools")];
    await expect(previewImport(member, { kind: "github", address: "https://git.acme.test/platform" })).rejects.toMatchObject({
      key: "sourceServerAdminOnly",
      values: { host: "git.acme.test" },
    });
    // github.com is for everyone who may create projects
    expect((await previewImport(member, { kind: "github", address: "acme" })).items).toHaveLength(1);
    // A link leading anywhere but the tool is not kept
    repos = [repo(512, "evil", { html_url: "javascript:alert(1)" })];
    const { created } = await importProjects(ws, { kind: "github", address: "acme" }, { ids: ["https://github.com#repo:512"] });
    expect(await sourceOf(created[0]!.id)).toMatchObject({ url: "" });
  });
});

describe("a project's logo", () => {
  it("is set by those who edit the project, as PNG, JPEG or WebP only", async () => {
    const project = await prisma.project.create({
      data: { workspaceId: f.workspaceId, slug: `logo-${Date.now().toString(36)}`, name: "Logo", leadId: f.hostPersonId },
    });
    const bytes = new Uint8Array(png);
    // A plain member does not lead it
    await expect(setProjectLogo(member, project.id, bytes)).rejects.toMatchObject({ key: "accessDenied" });
    await setProjectLogo(ws, project.id, bytes);
    // Drawn again as a 256 px square: what it declared is not what is kept
    const kept = await prisma.projectLogo.findUniqueOrThrow({ where: { projectId: project.id } });
    expect(kept.type).toBe("image/webp");
    expect(await sharp(kept.data).metadata()).toMatchObject({ width: 256, height: 256 });
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(setProjectLogo(ws, project.id, svg)).rejects.toMatchObject({ key: "logoFormat" });
    await setProjectLogo(ws, project.id, null);
    expect(await prisma.projectLogo.count({ where: { projectId: project.id } })).toBe(0);
  });
});

describe("keeping imported projects in sync (Team)", () => {
  let linearTracker: string;
  let githubTracker: string;
  beforeAll(async () => {
    await saveLicense(KEY);
    ({ id: linearTracker } = await saveTracker(ws, { kind: "linear", name: "Linear", config: { team: "ENG" }, token: "lin_api_x" }));
    ({ id: githubTracker } = await saveTracker(ws, { kind: "github", name: "Acme", config: { repo: "acme/app" }, token: "ghp_x" }));
  });

  it("imports Linear projects through a saved tracker, then follows them every hour", async () => {
    linearProjects = [
      {
        id: "lp-1",
        name: "Mobile app",
        description: "The app, on both stores",
        content: "## Scope\n\niOS and Android",
        url: "https://linear.app/acme/project/mobile-app-1",
        startDate: "2026-09-01",
        targetDate: "2026-11-30",
        progress: 0.4,
        status: { type: "started" },
        lead: { email: memberEmail },
        members: { nodes: [{ email: memberEmail }, { email: "stranger@else.test" }] },
      },
      {
        id: "lp-2",
        name: "Old idea",
        description: "",
        url: "https://linear.app/acme/project/old-2",
        progress: 0,
        status: { type: "backlog" },
        startDate: null,
        targetDate: null,
      },
    ];
    // A member may not use the token an administrator saved
    await expect(previewImport(member, { trackerId: linearTracker })).rejects.toMatchObject({ key: "accessDenied" });
    const preview = await previewImport(ws, { trackerId: linearTracker });
    expect(preview).toMatchObject({ kind: "linear", sync: true, partial: "tracker" });
    expect(preview.items.map((i) => [i.name, i.status, i.progress])).toEqual([
      ["Mobile app", "active", 0.4],
      ["Old idea", "proposed", 0],
    ]);
    const { created } = await importProjects(ws, { trackerId: linearTracker }, { ids: ["lp-1"], sync: true });
    const id = created[0]!.id;
    const p = await prisma.project.findUniqueOrThrow({ where: { id }, include: { members: true } });
    // The document and the people come with the import; only the people of the directory join it
    expect(p).toMatchObject({
      summary: "The app, on both stores",
      description: "## Scope\n\niOS and Android",
      leadId: f.memberId,
      sourceTrackerId: linearTracker,
    });
    expect(p.members.map((m) => m.personId)).toEqual([f.memberId]);
    expect(toProjectDTO(await followedProjectOf(id)).progress).toBe(0.4);

    // Linear moves on: its name, status, dates and progress follow, not what Ronde keeps
    linearProjects[0] = {
      ...linearProjects[0],
      name: "Mobile app 2.0",
      progress: 1,
      status: { type: "completed" },
      targetDate: "2026-12-15",
    };
    await prisma.project.update({ where: { id }, data: { summary: "Written in Ronde" } });
    await age(id, 2);
    expect(await syncProjects()).toBeGreaterThanOrEqual(1);
    expect(await row(id)).toMatchObject({ name: "Mobile app 2.0", status: "done", targetDate: "2026-12-15", summary: "Written in Ronde" });
    expect(await sourceOf(id)).toMatchObject({ progress: 1, problem: null });
    // Read less than an hour ago: not again
    asked.length = 0;
    await syncProjects();
    expect(asked.filter((a) => a.url.includes("linear"))).toHaveLength(0);

    // A refused token is noted, the project kept as it was; "Update now" tries again and the page says so
    mood = "refuse";
    await syncProject(ws, id);
    expect(await sourceOf(id)).toMatchObject({ problem: "refused" });
    expect(await row(id)).toMatchObject({ name: "Mobile app 2.0" });
    mood = "fine";
    await syncProject(ws, id);
    expect(await sourceOf(id)).toMatchObject({ problem: null });

    // Gone from Linear (or out of the token's reach): noted, tried again once a day, not every hour
    linearProjects = [];
    await syncProject(ws, id);
    expect(await sourceOf(id)).toMatchObject({ problem: "gone" });
    linearProjects = [
      {
        id: "lp-1",
        name: "Mobile app 3",
        description: "",
        url: "https://linear.app/acme/project/m-1",
        progress: 0.5,
        status: { type: "started" },
      },
    ];
    await age(id, 2);
    await syncProjects();
    expect(await sourceOf(id)).toMatchObject({ problem: "gone" });
    await age(id, 25);
    await syncProjects();
    expect(await row(id)).toMatchObject({ name: "Mobile app 3" });
    expect(await sourceOf(id)).toMatchObject({ problem: null });
  });

  it("keeps Ronde's start date where the tool has none, and the last count when counting fails", async () => {
    epics = [
      {
        id: "10077",
        key: "OPS-77",
        fields: { summary: "Backups", status: { statusCategory: { key: "new" } }, duedate: "2027-02-01", assignee: null },
      },
    ];
    const { id: jira } = await saveTracker(ws, {
      kind: "jira",
      name: "Jira",
      config: { site: "https://acme.atlassian.net", project: "OPS", email: "me@acme.test" },
      token: "atl",
    });
    const { created } = await importProjects(ws, { trackerId: jira }, { ids: ["https://acme.atlassian.net#10077"], sync: true });
    const id = created[0]!.id;
    expect(await sourceOf(id)).toMatchObject({ done: 3, total: 4 });
    await prisma.project.update({ where: { id }, data: { startDate: "2026-11-01" } });
    epics[0] = { ...epics[0], fields: { ...(epics[0]!.fields as object), status: { statusCategory: { key: "indeterminate" } } } };
    mood = "countsDown";
    await syncProject(ws, id);
    expect(await row(id)).toMatchObject({ status: "active", startDate: "2026-11-01", targetDate: "2027-02-01" });
    expect(await sourceOf(id)).toMatchObject({ done: 3, total: 4, progress: 0.75 });
  });

  it("keeps a synced repository's name, and marks it done once archived, Ronde's status and dates kept", async () => {
    repos = [repo(601, "search")];
    // The tracker names acme/app: its organization's repositories are offered
    const preview = await previewImport(ws, { trackerId: githubTracker, what: "repos" });
    expect(preview).toMatchObject({ what: "repos", where: "acme", sync: true });
    const { created } = await importProjects(ws, { trackerId: githubTracker, what: "repos" }, { ids: ids(preview.items), sync: true });
    const id = created[0]!.id;
    await prisma.project.update({ where: { id }, data: { status: "paused", startDate: "2026-10-01", targetDate: "2027-03-31" } });

    repos[0] = { ...repos[0], name: "search-v2" };
    await syncProject(ws, id);
    expect(await row(id)).toMatchObject({ name: "search-v2", status: "paused", startDate: "2026-10-01", targetDate: "2027-03-31" });
    repos[0] = { ...repos[0], archived: true };
    await syncProject(ws, id);
    expect(await row(id)).toMatchObject({ status: "done", targetDate: "2027-03-31" });
  });

  it("reads milestones one by one, wherever they sit in the repository's list", async () => {
    milestones = Array.from({ length: 120 }, (_, n) => milestone(n + 1, `m${n + 1}`));
    const { created } = await importProjects(
      ws,
      { trackerId: githubTracker, what: "milestones" },
      { ids: ["https://github.com#milestone:1050"], sync: true },
    );
    const id = created[0]!.id;
    // Closed since, and now past the first 100 of the repository's list: read by its number all the same
    const [fiftieth] = milestones.splice(49, 1);
    milestones.push({ ...fiftieth, closed_issues: 4, open_issues: 0, state: "closed" });
    await syncProject(ws, id);
    expect(await row(id)).toMatchObject({ status: "done" });
    expect(await sourceOf(id)).toMatchObject({ progress: 1, problem: null });
  });

  it("stops following the tool when asked (for good, even mid-run), when the tracker moves or is removed", async () => {
    linearProjects = [
      {
        id: "lp-3",
        name: "Search",
        description: "",
        url: "https://linear.app/acme/project/search-3",
        progress: 0.1,
        status: { type: "planned" },
      },
      {
        id: "lp-4",
        name: "Ranking",
        description: "",
        url: "https://linear.app/acme/project/ranking-4",
        progress: 0.2,
        status: { type: "planned" },
      },
    ];
    const { created } = await importProjects(ws, { trackerId: linearTracker }, { ids: ["lp-3", "lp-4"], sync: true });
    const [search, ranking] = created.map((c) => c.id) as [string, string];
    await unlinkSource(ws, search);
    expect(await row(search)).toMatchObject({ sourceTrackerId: null });
    expect(await sourceOf(search)).toMatchObject({ stopped: "unlinked", key: "Search" });
    await age(search, 2);
    linearProjects[0] = { ...linearProjects[0], name: "Search 2" };
    await syncProjects();
    expect(await row(search)).toMatchObject({ sourceTrackerId: null, name: "Search" });

    // The GitLab tracker now points at another server: the projects of the old one stop following it
    const { id: gitlab } = await saveTracker(ws, {
      kind: "gitlab",
      name: "GitLab",
      config: { url: "https://gitlab.acme.test", project: "acme/app" },
      token: "glpat",
    });
    glProjects = [
      {
        id: 81,
        name: "Web",
        path_with_namespace: "acme/web",
        description: "",
        web_url: "https://gitlab.acme.test/acme/web",
        archived: false,
      },
    ];
    const gl = await importProjects(
      ws,
      { trackerId: gitlab, what: "projects" },
      { ids: ["https://gitlab.acme.test#project:81"], sync: true },
    );
    await saveTracker(ws, { id: gitlab, kind: "gitlab", name: "GitLab", config: { url: "https://gitlab.new.test", project: "acme/app" } });
    asked.length = 0;
    await syncProject(ws, gl.created[0]!.id);
    // Nothing was sent to the new server with the old projects' ids
    expect(asked).toHaveLength(0);
    expect(await row(gl.created[0]!.id)).toMatchObject({ sourceTrackerId: null });
    expect(await sourceOf(gl.created[0]!.id)).toMatchObject({ stopped: "moved" });

    // The tracker removed: its projects stay, and say why they no longer follow their tool
    await deleteTracker(ws, linearTracker);
    expect(await row(ranking)).toMatchObject({ sourceTrackerId: null, name: "Ranking" });
    expect(await sourceOf(ranking)).toMatchObject({ stopped: "trackerRemoved" });
  });

  it("imports an item whose address another project took meanwhile", async () => {
    repos = [repo(801, "ledger")];
    const preview = await previewImport(ws, { kind: "github", address: "acme" });
    await prisma.project.create({ data: { workspaceId: f.workspaceId, slug: "ledger", name: "Ledger (by hand)" } });
    // The import took the workspace's addresses before "ledger" was made by hand
    const real = ws.db.project.findMany.bind(ws.db.project);
    let first = true;
    const spy = vi.spyOn(ws.db.project, "findMany").mockImplementation(((args: { select?: { slug?: boolean }; where?: unknown }) => {
      if (first && args?.select?.slug && !args.where) {
        first = false;
        return Promise.resolve([]);
      }
      return real(args as never);
    }) as never);
    try {
      const { created, failed } = await importProjects(ws, { kind: "github", address: "acme" }, { ids: ids(preview.items) });
      expect(first).toBe(false);
      expect(failed).toBe(0);
      expect(created).toHaveLength(1);
      expect(created[0]!.slug).not.toBe("ledger");
    } finally {
      spy.mockRestore();
    }
  });

  it("goes on with the other projects when one cannot be read this time", async () => {
    repos = [repo(901, "alpha"), repo(902, "beta")];
    const { id: gh } = await saveTracker(ws, { kind: "github", name: "Acme 2", config: { repo: "acme/app" }, token: "ghp_y" });
    const { created } = await importProjects(
      ws,
      { trackerId: gh, what: "repos" },
      { ids: ["https://github.com#repo:901", "https://github.com#repo:902"], sync: true },
    );
    const [alpha, beta] = created.map((c) => c.id) as [string, string];
    repos = [repo(901, "alpha-2"), { ...repo(902, "beta-2"), id: "broken" }];
    // The tool answers 500 for beta, alpha follows all the same
    const fake = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        url.endsWith("/repositories/902") ? new Response("{}", { status: 500 }) : (fake as typeof fetch)(url, init),
      ),
    );
    await age(alpha, 2);
    await age(beta, 2);
    await syncProjects();
    expect(await row(alpha)).toMatchObject({ name: "alpha-2" });
    expect(await sourceOf(alpha)).toMatchObject({ problem: null });
    expect(await row(beta)).toMatchObject({ name: "beta" });
    expect(await sourceOf(beta)).toMatchObject({ problem: "failed" });
  });

  it("brings an item in once, even when two imports run together", async () => {
    repos = [repo(701, "atlas")];
    const both = await Promise.all([
      importProjects(ws, { kind: "github", address: "acme" }, { ids: ["https://github.com#repo:701"] }),
      importProjects(ws, { kind: "github", address: "acme" }, { ids: ["https://github.com#repo:701"] }),
    ]);
    expect(both.flatMap((b) => b.created)).toHaveLength(1);
    expect(await prisma.project.count({ where: { workspaceId: f.workspaceId, name: "atlas" } })).toBe(1);
  });
});
