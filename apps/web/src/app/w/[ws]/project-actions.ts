"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { run } from "@/lib/server/action";
import { audit } from "@/lib/server/audit";
import { authorize, type WorkspaceContext } from "@/lib/server/authz";
import { OpError } from "@/lib/server/errors";
import { requireMeeting } from "@/lib/server/meeting/context";
import { runOp } from "@/lib/server/meeting/ops";
import { type ImportSourceInput, importProjects, previewImport, syncProject, unlinkSource } from "@/lib/server/project-import";
import {
  addTheme,
  archiveProject,
  createProject,
  deleteProject,
  deleteTheme,
  type ProjectInput,
  renameTheme,
  updateProject,
} from "@/lib/server/projects";

// The portfolio: projects, their themes, the meetings that follow them. Every action re-checks the permission

const refresh = (slug: string) => revalidatePath(`/w/${slug}`, "layout");
const log = (ctx: WorkspaceContext, action: string, targetId: string | null, data?: unknown) =>
  audit(ctx, ctx.db, { action, targetType: "project", targetId, data });

export async function createProjectAction(slug: string, input: ProjectInput) {
  return run(async () => {
    const ctx = await authorize(slug, "projects.create");
    const project = await createProject(ctx, input);
    await log(ctx, "projects.create", project.id, { name: input.name });
    refresh(slug);
    return project;
  });
}

export async function updateProjectAction(slug: string, id: string, input: ProjectInput) {
  return run(async () => {
    const ctx = await authorize(slug, "projects.read");
    const project = await updateProject(ctx, id, input);
    await log(ctx, "projects.update", id, { name: input.name });
    refresh(slug);
    return project;
  });
}

export async function archiveProjectAction(slug: string, id: string, archived: boolean) {
  return run(async () => {
    const ctx = await authorize(slug, "projects.read");
    await archiveProject(ctx, id, archived);
    await log(ctx, archived ? "projects.archive" : "projects.restore", id);
    refresh(slug);
    return null;
  });
}

export async function deleteProjectAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "projects.manage");
    await deleteProject(ctx, id);
    await log(ctx, "projects.delete", id);
    refresh(slug);
    return null;
  });
}

export async function addThemeAction(slug: string, name: string) {
  return run(async () => {
    const ctx = await authorize(slug, "projects.manage");
    const theme = await addTheme(ctx, name);
    await log(ctx, "projects.theme", theme.id, { name });
    refresh(slug);
    return { id: theme.id };
  });
}

export async function renameThemeAction(slug: string, id: string, name: string) {
  return run(async () => {
    const ctx = await authorize(slug, "projects.manage");
    await renameTheme(ctx, id, name);
    await log(ctx, "projects.theme", id, { name });
    refresh(slug);
    return null;
  });
}

export async function deleteThemeAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "projects.manage");
    await deleteTheme(ctx, id);
    await log(ctx, "projects.themeDelete", id);
    refresh(slug);
    return null;
  });
}

/** A meeting starts or stops following a project (its people configuring it decide) */
export async function followProjectAction(slug: string, meetingId: string, projectId: string, follow: boolean) {
  return run(async () => {
    const m = await requireMeeting(slug, meetingId, "meeting.configure");
    const current = (await m.ws.db.meetingProject.findMany({ where: { meetingId }, orderBy: { position: "asc" } })).map((r) => r.projectId);
    if (follow && current.includes(projectId)) throw new OpError("invalidRequest", { details: "already followed" });
    const projectIds = follow ? [...current, projectId] : current.filter((id) => id !== projectId);
    await runOp(m, { op: "meeting.projects", projectIds });
    refresh(slug);
    return null;
  });
}

/** What a tool holds, for the import dialog to list */
export async function previewImportAction(slug: string, source: ImportSourceInput) {
  return run(async () => previewImport(await authorize(slug, "projects.create"), source));
}

export async function importProjectsAction(
  slug: string,
  source: ImportSourceInput,
  pick: { ids: string[]; themeId: string | null; sync: boolean },
) {
  return run(async () => {
    const ctx = await authorize(slug, "projects.create");
    const { created, failed } = await importProjects(ctx, source, pick);
    refresh(slug);
    return { ids: created.map((c) => c.id), finished: created.filter((c) => c.finished).length, failed };
  });
}

const projectId = z.string().min(1).max(50);

/** "Update now" on a project kept in sync with its tool */
export async function syncProjectAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "projects.read");
    await syncProject(ctx, projectId.parse(id));
    refresh(slug);
    return null;
  });
}

/** Stops following the tool, for good: the project is edited in Ronde from then on */
export async function unlinkSourceAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "projects.read");
    await unlinkSource(ctx, projectId.parse(id));
    await log(ctx, "projects.unsync", id);
    refresh(slug);
    return null;
  });
}
