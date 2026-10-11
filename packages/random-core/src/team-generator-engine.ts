import type { BalanceCriterion, GeneratedTeam, Participant, TeamConstraint, TeamGenerationPlan } from "./random-tool-types";
import { createSeededRandom } from "./seeded-random";

export interface TeamGenerationInput {
  participants: Participant[];
  sizingMode: "team-count" | "members-per-team";
  size: number;
  teamNames: string[];
  constraints?: TeamConstraint[];
  criteria?: BalanceCriterion[];
  seed: string;
  lockedTeams?: GeneratedTeam[];
  lockedParticipantIds?: string[];
  searchBudget?: number;
}

export type TeamGenerationResult =
  | { status: "success"; plan: TeamGenerationPlan; balanceScore: number }
  | { status: "invalid_rules"; reason: string }
  | { status: "unsatisfiable"; reason: string }
  | { status: "search_limit_reached"; reason: string };

interface Group {
  ids: string[];
  apart: Set<number>;
}

type TeamGenerationFailure = Exclude<TeamGenerationResult, { status: "success" }>;

class UnionFind {
  private readonly parents = new Map<string, string>();

  constructor(ids: string[]) {
    for (const id of ids) this.parents.set(id, id);
  }

  find(id: string): string {
    const parent = this.parents.get(id);
    if (!parent) throw new Error(`Unknown participant ${id}`);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parents.set(id, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parents.set(rightRoot, leftRoot);
  }
}

function capacitiesFor(participantCount: number, mode: TeamGenerationInput["sizingMode"], size: number): number[] {
  if (!Number.isSafeInteger(size) || size < 1) return [];
  const teamCount = mode === "team-count" ? Math.min(size, participantCount) : Math.ceil(participantCount / size);
  if (teamCount < 1) return [];
  const base = Math.floor(participantCount / teamCount);
  const extra = participantCount % teamCount;
  return Array.from({ length: teamCount }, (_, index) => base + (index < extra ? 1 : 0));
}

function validateConstraintParticipants(ids: string[], constraints: TeamConstraint[]): string | undefined {
  const known = new Set(ids);
  for (const {
    participantIds: [left, right],
  } of constraints) {
    if (left === right || !known.has(left) || !known.has(right)) return "invalid_constraint_participant";
  }
  return undefined;
}

function connectApartGroups(groups: Group[], groupIndex: Map<string, number>, constraints: TeamConstraint[]): string | undefined {
  for (const constraint of constraints) {
    if (constraint.type !== "apart") continue;
    const left = groupIndex.get(constraint.participantIds[0]);
    const right = groupIndex.get(constraint.participantIds[1]);
    if (left === undefined || right === undefined) return "invalid_constraint_participant";
    if (left === right) return "conflicting_constraints";
    groups[left].apart.add(right);
    groups[right].apart.add(left);
  }
  return undefined;
}

function createGroups(participants: Participant[], constraints: TeamConstraint[]): { groups: Group[]; invalid?: string } {
  const ids = participants.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) return { groups: [], invalid: "duplicate_participant_id" };
  const invalidParticipant = validateConstraintParticipants(ids, constraints);
  if (invalidParticipant) return { groups: [], invalid: invalidParticipant };
  const union = new UnionFind(ids);
  for (const constraint of constraints) {
    if (constraint.type === "together") union.union(...constraint.participantIds);
  }
  const byRoot = new Map<string, string[]>();
  for (const id of ids) {
    const root = union.find(id);
    byRoot.set(root, [...(byRoot.get(root) ?? []), id]);
  }
  const groups = [...byRoot.values()].map((groupIds) => ({ ids: groupIds, apart: new Set<number>() }));
  const groupIndex = new Map<string, number>();
  groups.forEach((group, index) => group.ids.forEach((id) => groupIndex.set(id, index)));
  const invalid = connectApartGroups(groups, groupIndex, constraints);
  return invalid ? { groups: [], invalid } : { groups };
}

function scoreTeams(teams: string[][], participants: Map<string, Participant>, criteria: BalanceCriterion[]): number {
  if (criteria.length === 0) return 0;
  let score = 0;
  for (const criterion of criteria) {
    const total = teams.flat().reduce((sum, id) => sum + (participants.get(id)?.ratings[criterion.id] ?? 3), 0);
    const participantCount = teams.reduce((sum, team) => sum + team.length, 0);
    for (const team of teams) {
      const teamTotal = team.reduce((sum, id) => sum + (participants.get(id)?.ratings[criterion.id] ?? 3), 0);
      const target = total * (team.length / participantCount);
      score += Math.abs(teamTotal - target) * criterion.weight;
    }
  }
  return score;
}

function validateGenerationInput(input: TeamGenerationInput): TeamGenerationFailure | null {
  if (input.participants.length < 2) return { status: "invalid_rules", reason: "not_enough_participants" };
  if (input.criteria && (input.criteria.length > 3 || input.criteria.some(({ weight }) => weight < 1 || weight > 3))) {
    return { status: "invalid_rules", reason: "invalid_criteria" };
  }
  return null;
}

interface AssignmentState {
  assignments: string[][];
  assignedGroups: Map<number, number>;
  lockedIds: Set<string>;
}

function lockedAssignments(groups: Group[], capacities: number[], input: TeamGenerationInput): AssignmentState | TeamGenerationFailure {
  const assignments: string[][] = capacities.map(() => []);
  const assignedGroups = new Map<number, number>();
  const lockedIds = new Set(input.lockedParticipantIds ?? []);
  const lockedTeamById = new Map<string, number>();
  for (const [teamIndex, team] of (input.lockedTeams ?? []).entries()) {
    for (const id of team.participantIds) if (lockedIds.has(id) || team.locked) lockedTeamById.set(id, teamIndex);
  }

  for (const [groupIndex, group] of groups.entries()) {
    const requestedTeams = new Set(group.ids.map((id) => lockedTeamById.get(id)).filter((value): value is number => value !== undefined));
    if (requestedTeams.size > 1) return { status: "invalid_rules", reason: "locked_together_conflict" };
    const [teamIndex] = requestedTeams;
    if (teamIndex === undefined) continue;
    if (!assignments[teamIndex] || assignments[teamIndex].length + group.ids.length > capacities[teamIndex]) {
      return { status: "unsatisfiable", reason: "locked_team_full" };
    }
    if ([...group.apart].some((apartIndex) => assignedGroups.get(apartIndex) === teamIndex)) {
      return { status: "invalid_rules", reason: "locked_apart_conflict" };
    }
    assignments[teamIndex].push(...group.ids);
    assignedGroups.set(groupIndex, teamIndex);
  }
  return { assignments, assignedGroups, lockedIds };
}

interface SearchEntry {
  group: Group;
  index: number;
}

interface SearchContext {
  assignments: string[][];
  assignedGroups: Map<number, number>;
  best: string[][] | null;
  bestScore: number;
  budget: number;
  budgetReached: boolean;
  capacities: number[];
  criteria: BalanceCriterion[];
  participants: Map<string, Participant>;
  random: ReturnType<typeof createSeededRandom>;
  unassigned: SearchEntry[];
  visited: number;
}

function candidateTeams(context: SearchContext, entry: SearchEntry): number[] {
  return context.random.shuffle(context.capacities.map((_, index) => index)).filter((teamIndex) => {
    if (context.assignments[teamIndex].length + entry.group.ids.length > context.capacities[teamIndex]) return false;
    return ![...entry.group.apart].some((apartIndex) => context.assignedGroups.get(apartIndex) === teamIndex);
  });
}

function saveSearchSolution(context: SearchContext): void {
  const score = scoreTeams(context.assignments, context.participants, context.criteria);
  if (score >= context.bestScore) return;
  context.bestScore = score;
  context.best = context.assignments.map((team) => [...team]);
}

function visitSearch(context: SearchContext, position: number): void {
  if (context.visited >= context.budget) {
    context.budgetReached = true;
    return;
  }
  context.visited += 1;
  if (position === context.unassigned.length) {
    saveSearchSolution(context);
    return;
  }

  const entry = context.unassigned[position];
  for (const teamIndex of candidateTeams(context, entry)) {
    context.assignments[teamIndex].push(...entry.group.ids);
    context.assignedGroups.set(entry.index, teamIndex);
    visitSearch(context, position + 1);
    context.assignments[teamIndex].splice(-entry.group.ids.length);
    context.assignedGroups.delete(entry.index);
    if ((context.criteria.length === 0 && context.best) || context.budgetReached) return;
  }
}

function searchAssignments(
  groups: Group[],
  capacities: number[],
  input: TeamGenerationInput,
  initial: AssignmentState,
): Pick<SearchContext, "best" | "bestScore" | "budgetReached"> {
  const context: SearchContext = {
    ...initial,
    best: null,
    bestScore: Number.POSITIVE_INFINITY,
    budget: input.searchBudget ?? 50_000,
    budgetReached: false,
    capacities,
    criteria: input.criteria ?? [],
    participants: new Map(input.participants.map((participant) => [participant.id, participant])),
    random: createSeededRandom(input.seed),
    unassigned: groups
      .map((group, index) => ({ group, index }))
      .filter(({ index }) => !initial.assignedGroups.has(index))
      .sort((left, right) => right.group.apart.size - left.group.apart.size || right.group.ids.length - left.group.ids.length),
    visited: 0,
  };
  visitSearch(context, 0);
  return context;
}

function successResult(
  input: TeamGenerationInput,
  solution: string[][],
  lockedIds: Set<string>,
  balanceScore: number,
): TeamGenerationResult {
  const teams: GeneratedTeam[] = solution.map((participantIds, index) => ({
    id: `team-${index + 1}`,
    name: input.teamNames[index]?.trim() || `Team ${index + 1}`,
    participantIds,
    locked: input.lockedTeams?.[index]?.locked ?? false,
  }));
  return {
    status: "success",
    balanceScore,
    plan: { version: 1, seed: input.seed, sizingMode: input.sizingMode, teams, lockedParticipantIds: [...lockedIds] },
  };
}

function isSimpleGeneration(input: TeamGenerationInput, constraints: TeamConstraint[]): boolean {
  const hasLocks = (input.lockedParticipantIds?.length ?? 0) > 0 || input.lockedTeams?.some(({ locked }) => locked);
  return constraints.length === 0 && (input.criteria?.length ?? 0) === 0 && !hasLocks;
}

export function generateTeams(input: TeamGenerationInput): TeamGenerationResult {
  const invalidInput = validateGenerationInput(input);
  if (invalidInput) return invalidInput;
  const capacities = capacitiesFor(input.participants.length, input.sizingMode, input.size);
  if (capacities.length < 1) return { status: "invalid_rules", reason: "invalid_team_size" };
  const constraints = input.constraints ?? [];
  const grouped = createGroups(input.participants, constraints);
  if (grouped.invalid) return { status: "invalid_rules", reason: grouped.invalid };
  if (grouped.groups.some((group) => group.ids.length > Math.max(...capacities))) {
    return { status: "unsatisfiable", reason: "together_group_too_large" };
  }
  if (isSimpleGeneration(input, constraints)) {
    const shuffled = createSeededRandom(input.seed).shuffle(input.participants.map(({ id }) => id));
    let offset = 0;
    const solution = capacities.map((capacity) => shuffled.slice(offset, (offset += capacity)));
    return successResult(input, solution, new Set(), 0);
  }

  const initial = lockedAssignments(grouped.groups, capacities, input);
  if ("status" in initial) return initial;
  const search = searchAssignments(grouped.groups, capacities, input, initial);
  if (!search.best) {
    return search.budgetReached
      ? { status: "search_limit_reached", reason: "search_budget_exhausted" }
      : { status: "unsatisfiable", reason: "no_valid_distribution" };
  }
  return successResult(input, search.best, initial.lockedIds, search.bestScore);
}

function togetherGroup(participantId: string, constraints: TeamConstraint[]): Set<string> {
  const together = new Set([participantId]);
  let previousSize = 0;
  while (previousSize !== together.size) {
    previousSize = together.size;
    for (const constraint of constraints) {
      if (constraint.type !== "together") continue;
      const [left, right] = constraint.participantIds;
      if (together.has(left)) together.add(right);
      if (together.has(right)) together.add(left);
    }
  }
  return together;
}

function teamCapacity(plan: TeamGenerationPlan): number {
  const total = plan.teams.reduce((sum, team) => sum + team.participantIds.length, 0);
  return Math.ceil(total / plan.teams.length);
}

function violatesApartConstraint(moving: string[], targetIds: Set<string>, constraints: TeamConstraint[]): boolean {
  return constraints.some(
    (constraint) =>
      constraint.type === "apart" &&
      ((moving.includes(constraint.participantIds[0]) && targetIds.has(constraint.participantIds[1])) ||
        (moving.includes(constraint.participantIds[1]) && targetIds.has(constraint.participantIds[0]))),
  );
}

export function moveParticipant(
  plan: TeamGenerationPlan,
  participantId: string,
  targetTeamId: string,
  constraints: TeamConstraint[] = [],
): TeamGenerationPlan | null {
  const source = plan.teams.find((team) => team.participantIds.includes(participantId));
  const target = plan.teams.find((team) => team.id === targetTeamId);
  if (!source || !target || source.id === target.id || source.locked || target.locked) return null;
  const together = togetherGroup(participantId, constraints);
  const moving = [...together];
  if (moving.some((id) => plan.lockedParticipantIds.includes(id))) return null;
  if (!moving.every((id) => source.participantIds.includes(id))) return null;
  if (target.participantIds.length + moving.length > teamCapacity(plan)) return null;
  const targetIds = new Set(target.participantIds);
  if (violatesApartConstraint(moving, targetIds, constraints)) return null;
  return {
    ...plan,
    teams: plan.teams.map((team) => {
      if (team.id === source.id) return { ...team, participantIds: team.participantIds.filter((id) => !together.has(id)) };
      if (team.id === target.id) return { ...team, participantIds: [...team.participantIds, ...moving] };
      return team;
    }),
  };
}
