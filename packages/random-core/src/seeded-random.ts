const UINT32_RANGE = 0x1_0000_0000;

export interface SeededRandom {
  nextFloat: () => number;
  nextInt: (maxExclusive: number) => number;
  nextUint32: () => number;
  shuffle: <T>(values: readonly T[]) => T[];
}

function hashSeed(seed: string): [number, number, number, number] {
  let hash = 1_779_033_703 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3_432_918_353);
    hash = (hash << 13) | (hash >>> 19);
  }

  const next = (): number => {
    hash = Math.imul(hash ^ (hash >>> 16), 2_246_822_507);
    hash = Math.imul(hash ^ (hash >>> 13), 3_266_489_909);
    return (hash ^= hash >>> 16) >>> 0;
  };

  const state: [number, number, number, number] = [next(), next(), next(), next()];
  if (state.every((value) => value === 0)) state[0] = 1;
  return state;
}

function rotateLeft(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

/** Xoshiro128**: fast, deterministic and isolated from the entropy source. */
export function createSeededRandom(seed: string): SeededRandom {
  if (!seed.trim()) throw new RangeError("seed must not be empty");
  const state = hashSeed(seed);

  const nextUint32 = (): number => {
    const result = Math.imul(rotateLeft(Math.imul(state[1], 5), 7), 9) >>> 0;
    const temporary = (state[1] << 9) >>> 0;
    state[2] ^= state[0];
    state[3] ^= state[1];
    state[1] ^= state[2];
    state[0] ^= state[3];
    state[2] ^= temporary;
    state[3] = rotateLeft(state[3], 11);
    return result;
  };

  const nextInt = (maxExclusive: number): number => {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
      throw new RangeError("maxExclusive must be a positive integer no greater than 2^32");
    }
    const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
    let value = nextUint32();
    while (value >= limit) value = nextUint32();
    return value % maxExclusive;
  };

  const shuffle = <T>(values: readonly T[]): T[] => {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const target = nextInt(index + 1);
      [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
    }
    return shuffled;
  };

  return {
    nextFloat: () => nextUint32() / UINT32_RANGE,
    nextInt,
    nextUint32,
    shuffle,
  };
}

export function createRandomSeed(byteLength = 16): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 8 || byteLength > 64) {
    throw new RangeError("byteLength must be between 8 and 64");
  }
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new RangeError("Invalid base64url value");
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
