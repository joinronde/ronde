import "server-only";
import type { BlockData } from "@ronde/core/agenda";
import type { ProjectDTO, ProjectHealth } from "@ronde/core/types";
import { HOST_ID, repoPath } from "@ronde/core/util";
import type { ScopedClient, ScopedTx } from "@ronde/db";
import { OpError } from "../errors";
import { liveProgress, readSourceOf } from "../project-sources";
import { ms } from "./dto";

// Projects a meeting follows: their step in the project round, their shared sheet for the coming session
// (one being written per meeting and project, no session until it is presented), and the items people tied
// to them in their check-ins.

type Db = ScopedClient | ScopedTx;

/** Projects of the meeting, in its order, with their theme, their members and the sheet being written */
export async function followedProjects(db: Db, meetingId: string) {
  const rows = await db.meetingProject.findMany({
    where: { meetingId, project: { archivedAt: null } },
    orderBy: { position: "asc" },
    include: {
      project: {
        include: {
          theme: true,
          logo: { select: { updatedAt: true } },
          members: { select: { personId: true }, orderBy: { createdAt: "asc" } },
          updates: { where: { meetingId, sessionId: null } },
        },
      },
    },
  });
  return rows.map((r) => ({ ...r.project, position: r.position, sheet: r.project.updates[0] ?? null }));
}
export type FollowedProject = Awaited<ReturnType<typeof followedProjects>>[number];

/** Repositories a project links to, per forge */
function reposOf(links: unknown): ProjectDTO["repos"] {
  const out: ProjectDTO["repos"] = { gitlab: [], github: [] };
  for (const l of Array.isArray(links) ? links : []) {
    const kind = (l as { kind?: unknown })?.kind;
    const url = (l as { url?: unknown })?.url;
    if ((kind !== "gitlab" && kind !== "github") || typeof url !== "string") continue;
    const path = repoPath(kind, url);
    if (path) out[kind].push(path);
  }
  return out;
}

const sourceLinks = (raw: unknown) => {
  const s = readSourceOf(raw);
  return s && (s.kind === "github" || s.kind === "gitlab") ? [{ kind: s.kind, url: s.url }] : [];
};

/** A project as a meeting shows it; `people` keeps only those of the meeting (the others stay out of its snapshot) */
export const toProjectDTO = (p: FollowedProject, people?: Set<string>): ProjectDTO => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  summary: p.summary,
  theme: p.theme ? { id: p.theme.id, name: p.theme.name, color: p.theme.color, position: p.theme.position } : null,
  status: p.status,
  health: p.sheet?.health ?? p.health,
  leadId: p.leadId && (!people || people.has(p.leadId)) ? p.leadId : null,
  memberIds: [...new Set([...(p.leadId ? [p.leadId] : []), ...p.members.map((m) => m.personId)])].filter((id) => !people || people.has(id)),
  targetDate: p.targetDate,
  color: p.color,
  // Its links, and the GitHub or GitLab milestone it was imported from: their repositories' issues
  repos: reposOf([...(Array.isArray(p.links) ? p.links : []), ...sourceLinks(p.source)]),
  progress: liveProgress(p),
  logo: p.logo?.updatedAt.getTime() ?? null,
  position: p.position,
  sheet: p.sheet
    ? {
        health: p.sheet.health,
        headline: p.sheet.headline,
        updatedById: p.sheet.updatedById && (!people || people.has(p.sheet.updatedById)) ? p.sheet.updatedById : null,
        headlineById: p.sheet.headlineById && (!people || people.has(p.sheet.headlineById)) ? p.sheet.headlineById : null,
        // A sheet only reserved, never saved, has not been updated by anyone
        updatedAt: p.sheet.updatedById ? ms(p.sheet.updatedAt) : null,
        // Someone outside the meeting (a host who does not take part) shows as the host
        editingById:
          p.sheet.editingById && p.sheet.editingUntil && p.sheet.editingUntil.getTime() > Date.now()
            ? !people || people.has(p.sheet.editingById)
              ? p.sheet.editingById
              : HOST_ID
            : null,
        editingUntil: p.sheet.editingUntil ? ms(p.sheet.editingUntil) : null,
      }
    : null,
});

/** A sheet counts as written once it gives a health or a message */
export const sheetWritten = (s: { health: ProjectHealth | null; headline: string } | null | undefined) =>
  !!s && (!!s.health || !!s.headline.trim());

/** What the project round expands from: the active projects followed, who works on them, who wrote about them */
export async function projectRoundData(
  db: Db,
  meeting: { id: string; speakSec: number },
  projects?: FollowedProject[],
): Promise<NonNullable<BlockData["projects"]>> {
  const list = (projects ?? (await followedProjects(db, meeting.id))).filter((p) => p.status === "active");
  const [items, participants] = list.length
    ? await Promise.all([
        db.checkInItem.findMany({
          where: { meetingId: meeting.id, sessionId: null, projectId: { in: list.map((p) => p.id) } },
          select: { projectId: true, personId: true, contributors: { select: { personId: true } } },
        }),
        db.meetingParticipant.findMany({ where: { meetingId: meeting.id }, select: { personId: true } }),
      ])
    : [[], []];
  const people = new Set(participants.map((x) => x.personId));
  return {
    speakSec: meeting.speakSec,
    list: list.map((p) => {
      // Who wrote about it, and who joined their lines: they speak for it too
      const authorIds = [
        ...new Set(items.filter((i) => i.projectId === p.id).flatMap((i) => [i.personId, ...i.contributors.map((c) => c.personId)])),
      ];
      return {
        id: p.id,
        name: p.name,
        health: p.sheet?.health ?? p.health,
        themePosition: p.theme?.position ?? null,
        position: p.position,
        memberIds: toProjectDTO(p, people).memberIds,
        authorIds,
        filled: sheetWritten(p.sheet) || authorIds.length > 0,
      };
    }),
  };
}

type SheetIds = { workspaceId: string; meetingId: string; projectId: string };

/** How long the sheet stays reserved for the person writing it without news from their page (renewed meanwhile) */
export const SHEET_HOLD_MS = 90_000;

/**
 * The sheet being written for the coming session, created empty if there is none yet. Two people starting
 * at once both land on the same one (one draft per meeting and project, by a unique index).
 */
async function draftOf(db: ScopedTx, ids: SheetIds) {
  await db.projectUpdate.createMany({ data: [ids], skipDuplicates: true });
  return db.projectUpdate.findFirstOrThrow({
    where: { meetingId: ids.meetingId, projectId: ids.projectId, sessionId: null },
    select: { id: true, editingById: true, editingUntil: true, updatedAt: true, updatedById: true },
  });
}

/** Free for this person: nobody holds it, they do, or the reservation lapsed */
const freeFor = (by: string, now: Date) => ({ OR: [{ editingById: null }, { editingById: by }, { editingUntil: { lte: now } }] });

/** Someone else is writing the sheet: it stays theirs until they save, leave, or their reservation lapses */
async function refuseHeld(db: ScopedTx, id: string): Promise<never> {
  const s = await db.projectUpdate.findFirst({ where: { id }, select: { editingById: true } });
  const who = s?.editingById
    ? await db.person.findFirst({ where: { id: s.editingById }, select: { firstName: true, lastName: true } })
    : null;
  throw new OpError("projectSheetHeld", { name: [who?.firstName, who?.lastName].filter(Boolean).join(" ") });
}

/** Saves the sheet of a project for the coming session; saving releases the reservation of its author */
export async function saveProjectSheet(
  db: ScopedTx,
  ids: SheetIds,
  sheet: { health?: ProjectHealth | null; headline?: string },
  by: string,
  opts: {
    /** The host setting the health live, from the control room, goes through a reservation */
    force?: boolean;
    /** Saved as it is typed: the writer keeps the reservation */
    keep?: boolean;
  } = {},
) {
  const { force = false, keep = false } = opts;
  const now = new Date();
  const draft = await draftOf(db, ids);
  // Checked and written in one statement: a reservation taken meanwhile is not overwritten
  const { count } = await db.projectUpdate.updateMany({
    where: { id: draft.id, ...(force ? {} : freeFor(by, now)) },
    data: {
      ...(sheet.health !== undefined ? { health: sheet.health } : {}),
      ...(sheet.headline !== undefined ? { headline: sheet.headline, headlineById: sheet.headline.trim() ? by : null } : {}),
      ...(draft.editingById === by && !keep ? { editingById: null, editingUntil: null } : {}),
      updatedById: by,
      updatedAt: now,
    },
  });
  if (!count) await refuseHeld(db, draft.id);
}

/**
 * Reserves the sheet for the person starting to write it (`on`), extends their reservation, or releases it.
 * Returns whether the others must hear about it: a new holder, an extension (their pages know until when it
 * runs), a release; not a renewal while the reservation is still fresh.
 */
export async function holdProjectSheet(db: ScopedTx, ids: SheetIds, by: string, on: boolean): Promise<boolean> {
  const now = new Date();
  if (!on) {
    const where = { meetingId: ids.meetingId, projectId: ids.projectId, sessionId: null, editingById: by };
    // Reserved and left without a word: the empty sheet goes away
    const dropped = await db.projectUpdate.deleteMany({ where: { ...where, updatedById: null, health: null, headline: "" } });
    if (dropped.count) return true;
    // Reserving or releasing is not an update of the sheet: its date stays the one of its last save
    const draft = await db.projectUpdate.findFirst({ where, select: { id: true, updatedAt: true } });
    if (!draft) return false;
    await db.projectUpdate.updateMany({
      where: { id: draft.id, editingById: by },
      data: { editingById: null, editingUntil: null, updatedAt: draft.updatedAt },
    });
    return true;
  }
  const draft = await draftOf(db, ids);
  // Still fresh: nothing new for the others; past half its time, it is extended and they hear about it
  if (draft.editingById === by && (draft.editingUntil?.getTime() ?? 0) - now.getTime() > SHEET_HOLD_MS / 2) return false;
  const { count } = await db.projectUpdate.updateMany({
    where: { id: draft.id, ...freeFor(by, now) },
    data: { editingById: by, editingUntil: new Date(now.getTime() + SHEET_HOLD_MS), updatedAt: draft.updatedAt },
  });
  if (!count) await refuseHeld(db, draft.id);
  return true;
}

/**
 * Archiving: the sheets presented move to the session, and give the projects their latest health. A sheet
 * left empty (only reserved) is dropped: it would hide the last real one in the portfolio.
 */
export async function archiveProjectSheets(db: ScopedTx, meetingId: string, sessionId: string, presented: string[]) {
  if (!presented.length) return;
  const sheets = await db.projectUpdate.findMany({ where: { meetingId, sessionId: null, projectId: { in: presented } } });
  for (const s of sheets) {
    if (!sheetWritten(s)) {
      await db.projectUpdate.deleteMany({ where: { id: s.id } });
      continue;
    }
    await db.projectUpdate.update({ where: { id: s.id }, data: { sessionId, editingById: null, editingUntil: null } });
    if (s.health) await db.project.updateMany({ where: { id: s.projectId }, data: { health: s.health } });
  }
}
