import type { RacePlan, RaceTheme } from "./random-tool-types";
import { createSeededRandom } from "./seeded-random";

export const RACE_DURATIONS: Record<RaceTheme, number> = {
  rocket: 6_000,
  car: 6_500,
  horse: 7_000,
  snail: 8_000,
};

export function createRacePlan(participantIds: string[], theme: RaceTheme, seed: string): RacePlan {
  if (participantIds.length < 2 || new Set(participantIds).size !== participantIds.length) {
    throw new RangeError("A race needs at least two unique participants");
  }
  const random = createSeededRandom(seed);
  const ranking = random.shuffle(participantIds);
  const finishById = new Map(ranking.map((id, index) => [id, 0.88 + (index / Math.max(1, ranking.length - 1)) * 0.11]));
  const lanes = participantIds.map((participantId) => {
    const finishOffset = finishById.get(participantId) ?? 0.99;
    const increments = Array.from({ length: 11 }, () => 0.45 + random.nextFloat() * 1.1);
    const total = increments.reduce((sum, value) => sum + value, 0);
    let cumulative = 0;
    const samples = [{ offset: 0, progress: 0 }];
    increments.forEach((increment, index) => {
      cumulative += increment;
      samples.push({
        offset: Number((((index + 1) / increments.length) * finishOffset).toFixed(6)),
        progress: Number((cumulative / total).toFixed(6)),
      });
    });
    return { participantId, finishOffset: Number(finishOffset.toFixed(6)), samples };
  });
  return { version: 1, seed, theme, durationMs: RACE_DURATIONS[theme], ranking, lanes };
}

export function raceProgressAt(plan: RacePlan, participantId: string, elapsedMs: number): number {
  const lane = plan.lanes.find((candidate) => candidate.participantId === participantId);
  if (!lane) return 0;
  const offset = Math.max(0, Math.min(1, elapsedMs / plan.durationMs));
  if (offset >= lane.finishOffset) return 1;
  for (let index = 1; index < lane.samples.length; index += 1) {
    const next = lane.samples[index];
    const previous = lane.samples[index - 1];
    if (offset <= next.offset) {
      const span = next.offset - previous.offset;
      const local = span === 0 ? 1 : (offset - previous.offset) / span;
      return previous.progress + (next.progress - previous.progress) * local;
    }
  }
  return 1;
}
