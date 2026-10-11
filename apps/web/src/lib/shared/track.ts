// Named events for the audience measure, when the instance turned it on (UMAMI_*, see the root layout): the
// steps of a team's first weeks, never what they write. Nothing happens without it, or when it is blocked.

export function track(event: string, data?: Record<string, string | number>) {
  try {
    (window as unknown as { umami?: { track: (e: string, d?: object) => void } }).umami?.track(event, data);
  } catch {}
}
