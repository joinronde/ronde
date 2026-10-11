export interface Participant {
  id: string;
  name: string;
  ratings: Record<string, 1 | 2 | 3 | 4 | 5>;
}

export interface BalanceCriterion {
  id: string;
  name: string;
  weight: 1 | 2 | 3;
}

export type TeamConstraint = { type: "together"; participantIds: [string, string] } | { type: "apart"; participantIds: [string, string] };

export interface GeneratedTeam {
  id: string;
  name: string;
  participantIds: string[];
  locked: boolean;
}

export interface TeamGenerationPlan {
  version: 1;
  seed: string;
  sizingMode: "team-count" | "members-per-team";
  teams: GeneratedTeam[];
  lockedParticipantIds: string[];
}

export type RaceTheme = "horse" | "car" | "snail" | "rocket";

export interface RacePlan {
  version: 1;
  seed: string;
  theme: RaceTheme;
  durationMs: number;
  ranking: string[];
  lanes: Array<{
    participantId: string;
    finishOffset: number;
    samples: Array<{ offset: number; progress: number }>;
  }>;
}
