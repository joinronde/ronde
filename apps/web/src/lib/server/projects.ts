import "server-only";
import { decisionsOf } from "@ronde/core/minutes";
import { canManageProject } from "@ronde/core/permissions";
import { parseRecord } from "@ronde/core/record";
import { availableSlug, slugify } from "@ronde/core/slug";
import { PROJECT_HEALTHS, PROJECT_STATUSES, type ProjectHealth, type ProjectStatus } from "@ronde/core/types";
import type { Prisma } from "@ronde/db";
import { z } from "zod";
import type { WorkspaceContext } from "./authz";
import { AccessError, OpError } from "./errors";
import { featureOn } from "./license";
import { personName } from "./meeting/dto";
import { liveProgress, type ProjectSource, projectSyncOn, readSourceOf, type SourceKind, type SourceWhat } from "./project-sources";

// The portfolio of a workspace: its projects and their themes, shared by every meeting. A project's page
// gathers what its meetings said about it; the viewer only reads the sessions of meetings they can read.
// Enterprise adds programmes (a project holding others, three levels at most) and per-project rights: a
// project seen by its members only, and members allowed to edit it. A private project stays private when the
// license lapses; the members' right to edit goes back to the lead.

const PALETTE_SIZE = 6;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const LINK_KINDS = ["gitlab", "github", "jira", "linear", "url"] as const;
export type ProjectLink = { kind: (typeof LINK_KINDS)[number]; label: string; url: string };

const linkSchema = z.object({
  kind: z.enum(LINK_KINDS),
  label: z.string().trim().max(80),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), "Invalid link."),
});

export const projectInput = z.object({
  name: z.string().trim().min(1).max(100),
  summary: z.string().trim().max(200).default(""),
  description: z.string().max(20_000).default(""),
  themeId: z.string().max(50).nullable().default(null),
  status: z.enum(PROJECT_STATUSES as [ProjectStatus, ...ProjectStatus[]]).default("active"),
  health: z
    .enum(PROJECT_HEALTHS as [ProjectHealth, ...ProjectHealth[]])
    .nullable()
    .default(null),
  leadId: z.string().max(50).nullable().default(null),
  startDate: z.string().regex(DATE).nullable().default(null),
  targetDate: z.string().regex(DATE).nullable().default(null),
  links: z.array(linkSchema).max(20).default([]),
  memberIds: z.array(z.string().max(50)).max(200).default([]),
  /** Enterprise: the programme it belongs to, who sees it, whether its members edit it */
  parentId: z.string().max(50).nullable().optional(),
  visibility: z.enum(["workspace", "members"]).optional(),
  membersEdit: z.boolean().optional(),
});
export type ProjectInput = z.input<typeof projectInput>;

const readLinks = (v: unknown): ProjectLink[] => {
  const parsed = z.array(linkSchema).safeParse(v);
  return parsed.success ? parsed.data : [];
};

/** Levels of programmes at most: a programme, its projects, their sub-projects */
export const MAX_DEPTH = 3;

const programsOn = (ctx: WorkspaceContext) => featureOn("projects.programs", ctx.workspace);
const permissionsOn = (ctx: WorkspaceContext) => featureOn("projects.permissions", ctx.workspace);

interface Governed {
  leadId: string | null;
  visibility: "workspace" | "members";
  membersEdit: boolean;
  memberIds: string[];
}
const worksOn = (ctx: WorkspaceContext, p: Governed) => p.leadId === ctx.member.personId || p.memberIds.includes(ctx.member.personId);
/** A project seen by its members only shows to them and to the people managing every project */
export const seesProject = (ctx: WorkspaceContext, p: Governed) =>
  p.visibility === "workspace" || ctx.can("projects.manage") || worksOn(ctx, p);
/** Its lead and the people managing every project edit it; its members too when allowed (Enterprise) */
const editsProject = (ctx: WorkspaceContext, p: Governed) =>
  canManageProject(ctx.principal, p) || (p.membersEdit && permissionsOn(ctx) && worksOn(ctx, p));
/** Who may decide its programme, who sees it and who edits it: its lead and the people managing every project */
const governsProject = (ctx: WorkspaceContext, p: Governed) => canManageProject(ctx.principal, p);

/** The projects a person may see, as a Prisma filter */
export const visibleWhere = (ctx: WorkspaceContext) =>
  ctx.can("projects.manage")
    ? {}
    : {
        OR: [
          { visibility: "workspace" as const },
          { leadId: ctx.member.personId },
          { members: { some: { personId: ctx.member.personId } } },
        ],
      };

/** Meetings whose sessions the viewer may read: all of them for those who read every meeting, otherwise their own */
export async function readableMeetings(ctx: WorkspaceContext): Promise<Set<string> | null> {
  if (ctx.can("meeting.read")) return null;
  const rows = await ctx.db.meetingParticipant.findMany({ where: { personId: ctx.member.personId }, select: { meetingId: true } });
  return new Set(rows.map((r) => r.meetingId));
}
const readable = (set: Set<string> | null, meetingId: string) => !set || set.has(meetingId);

/** People of the workspace the input names must exist in it */
async function checkPeople(ctx: WorkspaceContext, ids: string[]) {
  if (!ids.length) return;
  const found = await ctx.db.person.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new OpError("invalidRequest", { details: "people" });
}

async function checkTheme(ctx: WorkspaceContext, themeId: string | null) {
  if (themeId && !(await ctx.db.projectTheme.findFirst({ where: { id: themeId }, select: { id: true } })))
    throw new OpError("invalidRequest", { details: "themeId" });
}

// ---------- Reading ----------

export interface PortfolioProject {
  id: string;
  slug: string;
  name: string;
  summary: string;
  themeId: string | null;
  status: ProjectStatus;
  health: ProjectHealth | null;
  lead: { id: string; name: string } | null;
  members: { id: string; name: string; color: number; avatar: number | null }[];
  startDate: string | null;
  targetDate: string | null;
  color: number;
  archived: boolean;
  /** Meetings that follow it */
  meetings: number;
  /** The last sheet presented that the viewer may read */
  last: { date: string; headline: string; health: ProjectHealth | null } | null;
  /** The viewer works on it */
  mine: boolean;
  /** Programme it belongs to (Enterprise) */
  parentId: string | null;
  /** Seen by its members only (Enterprise) */
  private: boolean;
  /** Imported from a tool counting its issues: how far along it is, from 0 to 1 */
  progress: number | null;
  /** Version of its logo (null: none, its initials stand in) */
  logo: number | null;
}

/** Where an imported project comes from, as its page shows it */
export interface ProjectSourceView {
  kind: SourceKind;
  what: SourceWhat;
  key: string;
  url: string;
  progress: number | null;
  done: number | null;
  total: number | null;
  importedAt: string;
  /** When the tool was last read for it */
  syncedAt: string | null;
  /**
   * synced: it follows the tool (Team); gone: the tool no longer finds it (tried again once a day); paused: the
   * plan no longer keeps it in sync (it will again with Team); once: imported once; then why it stopped
   */
  state: "synced" | "gone" | "paused" | "archived" | "once" | NonNullable<ProjectSource["stopped"]>;
  /** Why the last update did not go through */
  problem: Exclude<ProjectSource["problem"], "gone">;
  /** Its progress is the tool's current one */
  live: boolean;
}

function sourceView(
  ctx: WorkspaceContext,
  p: { source: unknown; sourceTrackerId: string | null; syncedAt: Date | null; archivedAt: Date | null },
): ProjectSourceView | null {
  const s = readSourceOf(p.source);
  if (!s) return null;
  const state: ProjectSourceView["state"] = p.sourceTrackerId
    ? !projectSyncOn(ctx.workspace)
      ? "paused"
      : // An archived project is left out of the hourly sync until it is restored
        p.archivedAt
        ? "archived"
        : s.problem === "gone"
          ? "gone"
          : "synced"
    : (s.stopped ?? "once");
  return {
    kind: s.kind,
    what: s.what,
    key: s.key,
    url: s.url,
    progress: s.progress,
    done: s.done,
    total: s.total,
    importedAt: s.importedAt,
    syncedAt: p.syncedAt?.toISOString() ?? null,
    state,
    problem: s.problem === "gone" ? null : s.problem,
    live: liveProgress(p) !== null,
  };
}

export interface Portfolio {
  themes: { id: string; name: string; description: string; color: number; position: number }[];
  projects: PortfolioProject[];
  /** The directory's active people; `isMe` marks the viewer (offered once, as themselves, when picking a lead) */
  people: { id: string; name: string; color: number; avatar: number | null; isMe?: boolean }[];
  canCreate: boolean;
  canManage: boolean;
  /** The plan has programmes and per-project rights (Enterprise) */
  programs: boolean;
  permissions: boolean;
}

const themesOf = async (ctx: WorkspaceContext): Promise<Portfolio["themes"]> =>
  (await ctx.db.projectTheme.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] })).map(
    ({ id, name, description, color, position }) => ({ id, name, description, color, position }),
  );

/** People who may work on a project: the active ones of the directory */
const peopleOf = async (ctx: WorkspaceContext): Promise<Portfolio["people"]> =>
  (
    await ctx.db.person.findMany({
      where: { active: true, deprovisionedAt: null },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true, color: true, avatar: { select: { updatedAt: true } } },
    })
  ).map((p) => ({
    id: p.id,
    name: personName(p),
    color: p.color,
    avatar: p.avatar?.updatedAt.getTime() ?? null,
    ...(p.id === ctx.member.personId ? { isMe: true } : {}),
  }));

export async function loadPortfolio(ctx: WorkspaceContext): Promise<Portfolio> {
  if (!ctx.can("projects.read")) throw new AccessError(403, "accessDenied");
  const [themes, projects, people, meetings] = await Promise.all([
    themesOf(ctx),
    ctx.db.project.findMany({
      where: visibleWhere(ctx),
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: {
        lead: { select: { id: true, firstName: true, lastName: true } },
        members: {
          include: {
            person: { select: { id: true, firstName: true, lastName: true, color: true, avatar: { select: { updatedAt: true } } } },
          },
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { meetings: true } },
        logo: { select: { updatedAt: true } },
        updates: {
          where: { sessionId: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { session: { select: { date: true } } },
        },
      },
    }),
    peopleOf(ctx),
    readableMeetings(ctx),
  ]);
  return {
    themes,
    projects: projects.map((p) => {
      const last = p.updates.find((u) => readable(meetings, u.meetingId));
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        summary: p.summary,
        themeId: p.themeId,
        status: p.status,
        health: p.health,
        lead: p.lead ? { id: p.lead.id, name: personName(p.lead) } : null,
        members: p.members.map((m) => ({
          id: m.person.id,
          name: personName(m.person),
          color: m.person.color,
          avatar: m.person.avatar?.updatedAt.getTime() ?? null,
        })),
        startDate: p.startDate,
        targetDate: p.targetDate,
        color: p.color,
        archived: !!p.archivedAt,
        meetings: p._count.meetings,
        last: last?.session ? { date: last.session.date, headline: last.headline, health: last.health } : null,
        mine: p.leadId === ctx.member.personId || p.members.some((m) => m.personId === ctx.member.personId),
        parentId: p.parentId,
        private: p.visibility === "members",
        progress: liveProgress(p),
        logo: p.logo?.updatedAt.getTime() ?? null,
      };
    }),
    people,
    canCreate: ctx.can("projects.create"),
    canManage: ctx.can("projects.manage"),
    programs: programsOn(ctx),
    permissions: permissionsOn(ctx),
  };
}

export interface ProjectPage {
  project: Omit<PortfolioProject, "last" | "meetings" | "mine"> & {
    description: string;
    links: ProjectLink[];
    theme: { id: string; name: string; color: number } | null;
    source: ProjectSourceView | null;
  };
  /** Meetings that follow it (the viewer's readable ones are links) */
  meetings: { id: string; name: string; readable: boolean; canConfigure: boolean }[];
  /** Meetings the viewer could add it to */
  addable: { id: string; name: string }[];
  /** What was said about it, session by session, newest first */
  timeline: {
    sessionId: string;
    date: string;
    meeting: { id: string; name: string };
    health: ProjectHealth | null;
    headline: string;
    items: { personId: string; name: string; role: string; text: string }[];
    decisions: string[];
  }[];
  actions: { id: string; text: string; status: string; owner: string; meetingId: string }[];
  themes: Portfolio["themes"];
  people: Portfolio["people"];
  canManage: boolean;
  /** May hand the project over to another lead */
  canHandOver: boolean;
  /** May decide its programme, who sees it and who edits it, and archive it */
  canGovern: boolean;
  /** May delete it: the people managing every project */
  canDelete: boolean;
  membersEdit: boolean;
  /** Its programme and its own projects (Enterprise), as the viewer may see them */
  parent: { id: string; slug: string; name: string } | null;
  children: { slug: string; name: string; health: ProjectHealth | null; status: ProjectStatus }[];
  /** The worst health among its projects, when it holds some */
  rolledHealth: ProjectHealth | null;
  /** Projects it could belong to: not itself, not one of its own, within the depth allowed */
  programmeChoices: { id: string; name: string }[];
  programs: boolean;
  permissions: boolean;
}

export async function loadProject(ctx: WorkspaceContext, slug: string): Promise<ProjectPage | null> {
  if (!ctx.can("projects.read")) throw new AccessError(403, "accessDenied");
  const p = await ctx.db.project.findFirst({
    where: { slug },
    include: {
      theme: true,
      lead: { select: { id: true, firstName: true, lastName: true } },
      members: {
        include: {
          person: { select: { id: true, firstName: true, lastName: true, color: true, avatar: { select: { updatedAt: true } } } },
        },
        orderBy: { createdAt: "asc" },
      },
      meetings: { include: { meeting: { select: { id: true, name: true, archivedAt: true } } } },
      logo: { select: { updatedAt: true } },
    },
  });
  if (!p) return null;
  const governed = { ...p, memberIds: p.members.map((m) => m.personId) };
  // A private project is a 404 to the people who may not see it
  if (!seesProject(ctx, governed)) return null;
  const meetingsRead = await readableMeetings(ctx);
  const [sheets, items, actions, own, themes, people, visible, tree] = await Promise.all([
    ctx.db.projectUpdate.findMany({
      where: { projectId: p.id, sessionId: { not: null } },
      select: { sessionId: true, meetingId: true, health: true, headline: true },
    }),
    ctx.db.checkInItem.findMany({
      where: { projectId: p.id, sessionId: { not: null } },
      orderBy: [{ position: "asc" }],
      select: {
        sessionId: true,
        meetingId: true,
        personId: true,
        role: true,
        text: true,
        person: { select: { firstName: true, lastName: true } },
      },
    }),
    ctx.db.action.findMany({
      where: { projectId: p.id, status: { not: "done" } },
      orderBy: { createdAt: "asc" },
      include: { owner: { select: { firstName: true, lastName: true } } },
    }),
    ctx.db.meetingParticipant.findMany({ where: { personId: ctx.member.personId, role: "host" }, select: { meetingId: true } }),
    themesOf(ctx),
    peopleOf(ctx),
    ctx.db.project.findMany({
      where: visibleWhere(ctx),
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true, health: true, status: true, parentId: true },
    }),
    projectTree(ctx),
  ]);
  // The sessions that spoke of the project, the viewer's readable ones, the newest first: each one read once
  const ids = [...new Set([...sheets, ...items].filter((x) => readable(meetingsRead, x.meetingId)).map((x) => x.sessionId!))];
  const sessions = await ctx.db.session.findMany({
    where: { id: { in: ids } },
    orderBy: { date: "desc" },
    // Years of a project's life; the page shows them a month at a time, more on demand
    take: 500,
    select: { id: true, date: true, record: true, meeting: { select: { id: true, name: true } } },
  });
  const timeline = sessions.map((s): ProjectPage["timeline"][number] => {
    const record = parseRecord(s.record);
    const notes = record?.notes ?? {};
    const sheet = sheets.find((u) => u.sessionId === s.id);
    return {
      sessionId: s.id,
      date: s.date,
      meeting: s.meeting,
      health: sheet?.health ?? record?.projects.find((x) => x.id === p.id)?.health ?? null,
      headline: sheet?.headline ?? "",
      items: items
        .filter((i) => i.sessionId === s.id)
        .map((i) => ({ personId: i.personId, name: personName(i.person), role: i.role, text: i.text })),
      decisions: [...decisionsOf(notes[`p:${p.id}`]), ...decisionsOf(notes[`qa:p:${p.id}`])],
    };
  });
  const hosted = new Set(own.map((o) => o.meetingId));
  const canConfigure = (meetingId: string) => ctx.can("meeting.configure") || hosted.has(meetingId);
  const followed = new Set(p.meetings.map((m) => m.meetingId));
  const addableRows = await ctx.db.meeting.findMany({
    where: { archivedAt: null, id: { notIn: [...followed] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const below = descendants(tree, p.id);
  const children = visible.filter((x) => x.parentId === p.id);
  const parent = p.parentId ? visible.find((x) => x.id === p.parentId) : undefined;
  const ownDepth = subtreeDepth(tree, p.id);
  return {
    project: {
      id: p.id,
      slug: p.slug,
      name: p.name,
      summary: p.summary,
      themeId: p.themeId,
      status: p.status,
      health: p.health,
      lead: p.lead ? { id: p.lead.id, name: personName(p.lead) } : null,
      members: p.members.map((m) => ({
        id: m.person.id,
        name: personName(m.person),
        color: m.person.color,
        avatar: m.person.avatar?.updatedAt.getTime() ?? null,
      })),
      startDate: p.startDate,
      targetDate: p.targetDate,
      color: p.color,
      archived: !!p.archivedAt,
      parentId: p.parentId,
      private: p.visibility === "members",
      progress: liveProgress(p),
      logo: p.logo?.updatedAt.getTime() ?? null,
      description: p.description,
      links: readLinks(p.links),
      theme: p.theme ? { id: p.theme.id, name: p.theme.name, color: p.theme.color } : null,
      source: sourceView(ctx, p),
    },
    meetings: p.meetings
      .filter((m) => !m.meeting.archivedAt)
      .map((m) => ({
        id: m.meeting.id,
        name: m.meeting.name,
        readable: readable(meetingsRead, m.meetingId),
        canConfigure: canConfigure(m.meetingId),
      })),
    addable: addableRows.filter((m) => canConfigure(m.id)),
    timeline,
    actions: actions
      .filter((a) => readable(meetingsRead, a.meetingId))
      .map((a) => ({ id: a.id, text: a.text, status: a.status, owner: personName(a.owner), meetingId: a.meetingId })),
    themes,
    people,
    canManage: editsProject(ctx, governed),
    canHandOver: ctx.can("projects.manage") || !p.leadId,
    canGovern: governsProject(ctx, governed),
    canDelete: ctx.can("projects.manage"),
    membersEdit: p.membersEdit,
    parent: parent ? { id: parent.id, slug: parent.slug, name: parent.name } : null,
    children: children.map((c) => ({ slug: c.slug, name: c.name, health: c.health, status: c.status })),
    rolledHealth: worst(children.map((c) => c.health)),
    programmeChoices: visible
      .filter((x) => x.id !== p.id && !below.has(x.id) && depthOf(tree, x.id) + ownDepth <= MAX_DEPTH)
      .map((x) => ({ id: x.id, name: x.name })),
    programs: programsOn(ctx),
    permissions: permissionsOn(ctx),
  };
}

// ---------- Programmes ----------

type Tree = Map<string, string | null>;
/** Every project of the workspace and its programme */
async function projectTree(ctx: WorkspaceContext): Promise<Tree> {
  const rows = await ctx.db.project.findMany({ select: { id: true, parentId: true } });
  return new Map(rows.map((r) => [r.id, r.parentId]));
}
/** Projects held by a project, at any level */
function descendants(tree: Tree, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (at: string) => {
    for (const [child, parent] of tree) if (parent === at && !out.has(child)) out.add(child), walk(child);
  };
  walk(id);
  return out;
}
/** Level of a project: 1 for a project in no programme */
function depthOf(tree: Tree, id: string): number {
  let depth = 1;
  for (let at = tree.get(id); at && depth <= MAX_DEPTH + 1; at = tree.get(at)) depth++;
  return depth;
}
/** Levels a project spans with the projects it holds: 1 when it holds none */
function subtreeDepth(tree: Tree, id: string): number {
  let deepest = 1;
  for (const d of descendants(tree, id)) {
    let n = 1;
    for (let at: string | null | undefined = d; at && at !== id; at = tree.get(at)) n++;
    deepest = Math.max(deepest, n);
  }
  return deepest;
}

const HEALTH_RANK: Record<ProjectHealth, number> = { offTrack: 0, atRisk: 1, onTrack: 2 };
const worst = (healths: (ProjectHealth | null)[]): ProjectHealth | null =>
  healths.reduce<ProjectHealth | null>((w, h) => (h && (!w || HEALTH_RANK[h] < HEALTH_RANK[w]) ? h : w), null);

/** A programme for a project: refused when it would hold itself, or go deeper than allowed */
async function checkParent(ctx: WorkspaceContext, id: string | null, parentId: string | null) {
  if (!parentId) return;
  const tree = await projectTree(ctx);
  if (!tree.has(parentId) || parentId === id || (id && descendants(tree, id).has(parentId))) throw new OpError("projectProgramme");
  if (depthOf(tree, parentId) + (id ? subtreeDepth(tree, id) : 1) > MAX_DEPTH) throw new OpError("projectProgramme");
}

// ---------- Changing ----------

async function dataOf(ctx: WorkspaceContext, raw: ProjectInput) {
  const input = projectInput.parse(raw);
  await checkTheme(ctx, input.themeId);
  const memberIds = [...new Set([...(input.leadId ? [input.leadId] : []), ...input.memberIds])];
  await checkPeople(ctx, memberIds);
  if (input.startDate && input.targetDate && input.targetDate < input.startDate)
    throw new OpError("invalidRequest", { details: "targetDate" });
  const { memberIds: _, parentId, visibility, membersEdit, ...data } = input;
  return { data, memberIds, governance: { parentId, visibility, membersEdit } };
}

/** The Enterprise settings of a project, kept as they are when the plan lacks them or the person may not decide */
async function governanceOf(
  ctx: WorkspaceContext,
  id: string | null,
  g: { parentId?: string | null; visibility?: "workspace" | "members"; membersEdit?: boolean },
  allowed: boolean,
) {
  const out: { parentId?: string | null; visibility?: "workspace" | "members"; membersEdit?: boolean } = {};
  if (allowed && programsOn(ctx) && g.parentId !== undefined) {
    await checkParent(ctx, id, g.parentId);
    out.parentId = g.parentId;
  }
  if (allowed && permissionsOn(ctx)) {
    if (g.visibility) out.visibility = g.visibility;
    if (g.membersEdit !== undefined) out.membersEdit = g.membersEdit;
  }
  return out;
}

async function setMembers(ctx: WorkspaceContext, projectId: string, memberIds: string[]) {
  await ctx.db.projectMember.deleteMany({ where: { projectId, personId: { notIn: memberIds } } });
  const have = new Set((await ctx.db.projectMember.findMany({ where: { projectId }, select: { personId: true } })).map((m) => m.personId));
  const add = memberIds.filter((id) => !have.has(id));
  if (add.length)
    await ctx.db.projectMember.createMany({ data: add.map((personId) => ({ workspaceId: ctx.workspace.id, projectId, personId })) });
}

/** Where an imported project comes from, written with it (project-import.ts) */
export interface ImportedFrom {
  source: Prisma.InputJsonObject;
  sourceKey: string;
  sourceTrackerId: string | null;
  syncedAt: Date | null;
}

/**
 * A new project; its creator leads it unless someone else is named. An import passes where it comes from, and
 * the slugs and count it keeps up to date across the projects it creates.
 */
export async function createProject(
  ctx: WorkspaceContext,
  raw: ProjectInput,
  imported?: { from: ImportedFrom; slugs: Set<string>; count: { n: number } },
) {
  if (!ctx.can("projects.create")) throw new AccessError(403, "accessDenied");
  const { data, memberIds, governance } = await dataOf(ctx, { ...raw, leadId: raw.leadId ?? ctx.member.personId });
  const extra = await governanceOf(ctx, null, governance, true);
  const taken = imported?.slugs ?? new Set((await ctx.db.project.findMany({ select: { slug: true } })).map((p) => p.slug));
  const base = slugify(data.name, 36);
  const slug = availableSlug(base === "workspace" && !/workspace/i.test(data.name) ? "project" : base, taken);
  const count = imported ? imported.count.n : await ctx.db.project.count();
  const project = await ctx.db.project.create({
    data: {
      ...data,
      ...extra,
      ...(imported?.from ?? {}),
      workspaceId: ctx.workspace.id,
      slug,
      position: count,
      color: count % PALETTE_SIZE,
    },
  });
  if (imported) {
    taken.add(slug);
    imported.count.n++;
  }
  await setMembers(ctx, project.id, [...new Set([...(data.leadId ? [data.leadId] : []), ...memberIds])]);
  return { id: project.id, slug };
}

/** A project the person may edit, or the error saying why not */
export async function editableProject(ctx: WorkspaceContext, id: string) {
  const row = await ctx.db.project.findFirst({
    where: { id },
    select: { id: true, leadId: true, slug: true, visibility: true, membersEdit: true, members: { select: { personId: true } } },
  });
  if (!row) throw new OpError("notFound");
  const p = { ...row, memberIds: row.members.map((m) => m.personId) };
  if (!seesProject(ctx, p)) throw new OpError("notFound");
  if (!editsProject(ctx, p)) throw new AccessError(403, "accessDenied");
  return p;
}

export async function updateProject(ctx: WorkspaceContext, id: string, raw: ProjectInput) {
  const p = await editableProject(ctx, id);
  const { data, memberIds, governance } = await dataOf(ctx, raw);
  // Only those who manage every project hand a project over to another lead
  if (data.leadId !== p.leadId && !ctx.can("projects.manage") && p.leadId) throw new AccessError(403, "accessDenied");
  const extra = await governanceOf(ctx, p.id, governance, governsProject(ctx, p));
  await ctx.db.project.update({ where: { id: p.id }, data: { ...data, ...extra, links: data.links } });
  await setMembers(ctx, p.id, memberIds);
  return { slug: p.slug };
}

export async function archiveProject(ctx: WorkspaceContext, id: string, archived: boolean) {
  const p = await editableProject(ctx, id);
  if (!governsProject(ctx, p)) throw new AccessError(403, "accessDenied");
  await ctx.db.project.update({ where: { id: p.id }, data: { archivedAt: archived ? new Date() : null } });
  // An archived project leaves the meetings' check-ins: what people were writing about it goes back to their own
  // tab, and the sheets being written go; the meetings keep following it, for when it is restored
  if (archived) {
    await ctx.db.checkInItem.updateMany({ where: { projectId: p.id, sessionId: null }, data: { projectId: null } });
    await ctx.db.projectUpdate.deleteMany({ where: { projectId: p.id, sessionId: null } });
  }
}

/** Deletes a project: its sheets go, the items and actions about it stay without a project */
export async function deleteProject(ctx: WorkspaceContext, id: string) {
  if (!ctx.can("projects.manage")) throw new AccessError(403, "accessDenied");
  const { count } = await ctx.db.project.deleteMany({ where: { id } });
  if (!count) throw new OpError("notFound");
}

export async function addTheme(ctx: WorkspaceContext, name: string, description = "") {
  if (!ctx.can("projects.manage")) throw new AccessError(403, "accessDenied");
  const label = name.trim().slice(0, 60);
  if (!label) throw new OpError("nameRequired");
  if (await ctx.db.projectTheme.findFirst({ where: { name: label }, select: { id: true } })) throw new OpError("themeExists");
  const position = await ctx.db.projectTheme.count();
  return ctx.db.projectTheme.create({
    data: {
      workspaceId: ctx.workspace.id,
      name: label,
      description: description.trim().slice(0, 300),
      position,
      color: position % PALETTE_SIZE,
    },
  });
}

export async function renameTheme(ctx: WorkspaceContext, id: string, name: string) {
  if (!ctx.can("projects.manage")) throw new AccessError(403, "accessDenied");
  const label = name.trim().slice(0, 60);
  if (!label) throw new OpError("nameRequired");
  if (await ctx.db.projectTheme.findFirst({ where: { name: label, NOT: { id } }, select: { id: true } })) throw new OpError("themeExists");
  const { count } = await ctx.db.projectTheme.updateMany({ where: { id }, data: { name: label } });
  if (!count) throw new OpError("notFound");
}

export async function deleteTheme(ctx: WorkspaceContext, id: string) {
  if (!ctx.can("projects.manage")) throw new AccessError(403, "accessDenied");
  const { count } = await ctx.db.projectTheme.deleteMany({ where: { id } });
  if (!count) throw new OpError("notFound");
}
