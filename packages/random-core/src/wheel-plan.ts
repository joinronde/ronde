import { wheelTargetRotation } from "./game-random";
import { buildSpinSamples, type SpinSample, sectorJitter, settleOvershootFor } from "./spin-motion";

export interface WheelSpinPlan {
  duration: number;
  samples: SpinSample[];
  targetAngle: number;
}

/**
 * Plans a wheel spin landing on `awardIndex`: target angle (with a random offset inside the sector),
 * duration and keyframes. With reduced motion, the spin is short and has no settling overshoot; the
 * result is still reached and shown, only the staging is reduced.
 *
 * `randoms` come from the caller (a server-drawn seed), so every screen plays the exact same spin.
 */
export function planWheelSpin(
  currentAngle: number,
  awardIndex: number,
  totalSections: number,
  rotationTime: number,
  reduceMotion: boolean,
  randoms: { jitter: number; turns: number },
): WheelSpinPlan {
  const sectorSize = 360 / totalSections;
  const turns = reduceMotion ? 1 : randoms.turns;
  const duration = reduceMotion ? Math.min(600, rotationTime) : rotationTime;
  const targetAngle = wheelTargetRotation(currentAngle, awardIndex, totalSections, turns) + sectorJitter(sectorSize, randoms.jitter);
  return {
    duration,
    samples: buildSpinSamples(currentAngle, targetAngle, {
      settleOvershoot: reduceMotion ? 0 : settleOvershootFor(sectorSize),
    }),
    targetAngle,
  };
}
