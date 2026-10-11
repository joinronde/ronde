export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError("maxExclusive must be a positive safe integer");
  if (maxExclusive > 0x1_0000_0000) throw new RangeError("maxExclusive must not exceed 2^32");

  const range = 0x1_0000_0000;
  const limit = range - (range % maxExclusive);
  const values = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % maxExclusive;
}

export function rouletteTargetRotation(currentRotation: number, targetIndex: number, segmentCount: number, turns = 7): number {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= segmentCount) throw new RangeError("Invalid target segment");
  const segmentAngle = 360 / segmentCount;
  const targetModulo = (360 - (targetIndex * segmentAngle + segmentAngle / 2)) % 360;
  const currentModulo = ((currentRotation % 360) + 360) % 360;
  const forwardDelta = (targetModulo - currentModulo + 360) % 360;
  return currentRotation + turns * 360 + forwardDelta;
}

export function wheelTargetRotation(currentRotation: number, targetIndex: number, segmentCount: number, turns = 8): number {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= segmentCount) throw new RangeError("Invalid target segment");
  const segmentAngle = 360 / segmentCount;
  const targetModulo = (((360 - targetIndex * segmentAngle) % 360) + 360) % 360;
  const currentModulo = ((currentRotation % 360) + 360) % 360;
  const forwardDelta = (targetModulo - currentModulo + 360) % 360;
  return currentRotation + turns * 360 + forwardDelta;
}

export function coinTargetRotation(currentRotation: number, tails: boolean, turns = 5): number {
  const targetModulo = tails ? 180 : 0;
  const currentModulo = ((currentRotation % 360) + 360) % 360;
  const forwardDelta = (targetModulo - currentModulo + 360) % 360;
  return currentRotation + turns * 360 + forwardDelta;
}
