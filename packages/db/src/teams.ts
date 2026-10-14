// A team named by a company directory (LDAP, SCIM): found by its name, or made like the ones made by hand, last
// in the list and in the next colour of the palette (not all in the first one, at the top)

/** Colours a team may take (the palette of the interface) */
export const TEAM_PALETTE_SIZE = 6;
/** A team's name, as long as it may be */
export const TEAM_NAME_MAX = 60;

/** What it needs of a client: the full one, or one scoped to the workspace */
interface TeamsClient {
  jobCategory: {
    findFirst(args: { where: { workspaceId: string; name: string }; select: { id: true } }): PromiseLike<{ id: string } | null>;
    count(args: { where: { workspaceId: string } }): PromiseLike<number>;
    create(args: {
      data: { workspaceId: string; name: string; position: number; color: number };
      select: { id: true };
    }): PromiseLike<{ id: string }>;
  };
}

/** The team of that name in the workspace, made if missing; its id */
export async function ensureTeam(db: TeamsClient, workspaceId: string, rawName: string): Promise<string> {
  const name = rawName.trim().slice(0, TEAM_NAME_MAX);
  const found = await db.jobCategory.findFirst({ where: { workspaceId, name }, select: { id: true } });
  if (found) return found.id;
  const position = await db.jobCategory.count({ where: { workspaceId } });
  try {
    const made = await db.jobCategory.create({
      data: { workspaceId, name, position, color: position % TEAM_PALETTE_SIZE },
      select: { id: true },
    });
    return made.id;
  } catch (e) {
    // Made meanwhile by another sign-in or sync of the same directory: that one serves
    const again = await db.jobCategory.findFirst({ where: { workspaceId, name }, select: { id: true } });
    if (again) return again.id;
    throw e;
  }
}
