export function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value) || typeof value === "string") return value.length === 0;
  if (value instanceof Map || value instanceof Set) return value.size === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function randomIndex(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const maxUint32 = 0x1_0000_0000;
  const limit = maxUint32 - (maxUint32 % maxExclusive);
  const buffer = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return buffer[0] % maxExclusive;
}

export function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = randomIndex(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null || typeof left !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => key in rightRecord && deepEqual(leftRecord[key], rightRecord[key]))
  );
}

export function debounce<T extends (...args: never[]) => void>(callback: T, delay = 0): T & { cancel: () => void } {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const debounced = ((...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), delay);
  }) as T & { cancel: () => void };
  debounced.cancel = () => {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
  };
  return debounced;
}

export function throttle(callback: () => void, delay = 100): () => void {
  let lastRun = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return () => {
    const remaining = delay - (Date.now() - lastRun);
    if (remaining <= 0) {
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
      lastRun = Date.now();
      callback();
    } else if (!timeout) {
      timeout = setTimeout(() => {
        timeout = undefined;
        lastRun = Date.now();
        callback();
      }, remaining);
    }
  };
}
