// The directory's teams as a tree (a department, its teams, their squads): what the pickers, the directory and the
// teams page compute from the flat list. Pure, so the server-free tests check them.

export interface TeamLike {
  id: string;
  parentId: string | null;
}

/** Ids of a team and of every team under it */
export function teamAndBelow(teams: readonly TeamLike[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of teams)
      if (t.parentId && out.has(t.parentId) && !out.has(t.id)) {
        out.add(t.id);
        grew = true;
      }
  }
  return out;
}

/** "Department › Squad": the names from the top down to the team; empty for no team (a loop stops once round) */
export function teamPath(teams: readonly (TeamLike & { name: string })[], id: string | null): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let t = teams.find((x) => x.id === id); t && !seen.has(t.id); t = teams.find((x) => x.id === t!.parentId)) {
    seen.add(t.id);
    names.unshift(t.name);
  }
  return names.join(" › ");
}

/**
 * Teams in the order of the tree (a parent, then its children), each with its depth. A team whose parent is gone
 * shows at the top; teams caught in a loop (which the server refuses, but data may hold) show at the top too,
 * rather than nowhere
 */
export function teamOptions<T extends TeamLike>(teams: readonly T[]): { team: T; depth: number }[] {
  const known = new Set(teams.map((x) => x.id));
  const out: { team: T; depth: number }[] = [];
  const placed = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const team of teams.filter((x) => (x.parentId && known.has(x.parentId) ? x.parentId : null) === parent)) {
      if (placed.has(team.id)) continue;
      placed.add(team.id);
      out.push({ team, depth });
      walk(team.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const team of teams)
    if (!placed.has(team.id)) {
      placed.add(team.id);
      out.push({ team, depth: 0 });
      walk(team.id, 1);
    }
  return out;
}
