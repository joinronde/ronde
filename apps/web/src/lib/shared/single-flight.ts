// One run at a time per key: callers arriving while it runs wait for that run instead of starting their own
// (a token renewed once, not by every request that saw it expire). Pure, for the server-free tests

export function singleFlight<T>() {
  const running = new Map<string, Promise<T>>();
  return (key: string, run: () => Promise<T>): Promise<T> => {
    const now = running.get(key);
    if (now) return now;
    const next = run().finally(() => running.delete(key));
    running.set(key, next);
    return next;
  };
}
