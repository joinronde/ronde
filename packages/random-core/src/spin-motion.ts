/**
 * Kinematic model shared by the spinning draws (wheel, roulette, coin).
 *
 * A single CSS transition describes a spin badly. `cubic-bezier(0, .1, .45, .99)` starts at infinite
 * speed (the wheel went from rest to more than 4000°/s in one frame), then dies out so early that a
 * second transition was needed to reach the target, hence a stop followed by a crawl.
 *
 * So the angular velocity is described, and the position is derived by integration: spin-up from rest,
 * a controlled peak, then a continuous decay down to an exact stop on the target position.
 */

/** Share of the spin spent speeding up. */
const LAUNCH_RATIO = 0.085;

/** Speed decay. Beyond ~1.6 the end of the spin drags. */
const DECAY_EXPONENT = 1.35;

/** Resolution of the position table. 256 steps keep the error below 0.01°. */
const TABLE_SIZE = 256;

/** Samples produced for an animation. Dense enough for the linear interpolation not to show. */
const DEFAULT_SAMPLE_COUNT = 60;

/** Share of the travel during which the settling overshoot fades out. */
const SETTLE_WINDOW = 0.08;

function smoothStep(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value * value * (3 - 2 * value);
}

/** Brings an angle back into `[0, 360)`, negative values included. */
export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

/**
 * Normalised angular velocity at a moment of the spin.
 *
 * Zero at both ends: the wheel starts from rest and stops there, without the jolt at the start or the
 * hard stop that Bezier curves produced.
 */
export function spinVelocity(progress: number): number {
  if (progress <= 0 || progress >= 1) return 0;
  return smoothStep(progress / LAUNCH_RATIO) * (1 - progress) ** DECAY_EXPONENT;
}

/** Cumulative table of `spinVelocity`, normalised so the total travel is 1. */
const distanceTable = ((): number[] => {
  const table = new Array<number>(TABLE_SIZE + 1);
  table[0] = 0;
  let total = 0;
  for (let step = 1; step <= TABLE_SIZE; step++) {
    const previous = (step - 1) / TABLE_SIZE;
    const current = step / TABLE_SIZE;
    // Trapezoids: the velocity is continuous, two points per step are enough.
    total += ((spinVelocity(previous) + spinVelocity(current)) / 2) * (1 / TABLE_SIZE);
    table[step] = total;
  }
  for (let step = 0; step <= TABLE_SIZE; step++) table[step] /= total;
  return table;
})();

/**
 * Share of the travel covered at a given moment, between 0 and 1.
 * Monotonically increasing, exactly 0 at 0 and 1 at 1.
 */
export function spinDistance(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const position = progress * TABLE_SIZE;
  const index = Math.floor(position);
  const ratio = position - index;
  return distanceTable[index] + (distanceTable[index + 1] - distanceTable[index]) * ratio;
}

export interface SpinSample {
  angle: number;
  offset: number;
}

export interface SpinSampleOptions {
  /** Overshoot in degrees absorbed at the end of the travel, for a subtle notch settle. */
  settleOvershoot?: number;
  /** Number of keyframes produced. */
  samples?: number;
}

/**
 * Samples the trajectory between two cumulative angles.
 *
 * Keyframes are produced rather than a CSS easing function: `linear()` is not available everywhere, and
 * its absence would invalidate the whole `transition` declaration, removing the animation instead of
 * degrading it.
 */
export function buildSpinSamples(fromAngle: number, toAngle: number, options: SpinSampleOptions = {}): SpinSample[] {
  const count = Math.max(2, options.samples ?? DEFAULT_SAMPLE_COUNT);
  const overshoot = options.settleOvershoot ?? 0;
  const travel = toAngle - fromAngle;
  const direction = Math.sign(travel) || 1;

  return Array.from({ length: count + 1 }, (_, step) => {
    const offset = step / count;
    const base = fromAngle + travel * spinDistance(offset);
    // The overshoot appears then fades within the same travel: no second transition, so no dead
    // time before the result.
    const settle = offset <= 1 - SETTLE_WINDOW ? 0 : Math.sin(((offset - (1 - SETTLE_WINDOW)) / SETTLE_WINDOW) * Math.PI);
    return { angle: base + direction * overshoot * settle, offset };
  });
}

/**
 * Random offset, in degrees, around the centre of a sector.
 *
 * Stopping at the exact centre at every spin gives the computation away. `spread` bounds the offset to
 * a fraction of the half sector: the default leaves a comfortable margin to the edges, settling
 * overshoot included. A wide moving part (the roulette ball) needs a smaller value to stay visually
 * inside its slot.
 */
export function sectorJitter(sectorSize: number, unitRandom: number, spread = 0.28): number {
  const clamped = Math.max(0, Math.min(1, unitRandom));
  return (clamped - 0.5) * 2 * sectorSize * spread;
}

/** Settling overshoot, bounded to stay invisible on wheels with many sectors. */
export function settleOvershootFor(sectorSize: number): number {
  return Math.min(sectorSize * 0.08, 5);
}
