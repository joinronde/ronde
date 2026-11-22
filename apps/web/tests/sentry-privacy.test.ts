import { describe, expect, it } from "vitest";
import { BROWSER_NOISE, scrubBreadcrumb, scrubEvent, scrubText } from "@/lib/shared/sentry-privacy";

// Error reports leave without the secrets of a link or anyone's address

describe("error reports", () => {
  it("take the secret out of links and the addresses out of messages", () => {
    expect(scrubText("https://app.joinronde.com/g/Abc123secret/x?y=1")).toBe("https://app.joinronde.com/g/…/x?y=1");
    expect(scrubText("/invite/tok_42 /api/calendar/feed.ics /unsubscribe/weekly/sig")).toBe("/invite/… /api/calendar/… /unsubscribe/…/sig");
    expect(scrubText("sending to ana.costa@acme.com failed")).toBe("sending to …@… failed");
  });

  it("scrub the page, the error and the breadcrumbs, and drop what the console printed", () => {
    const event = scrubEvent({
      request: { url: "https://app/g/secret" },
      exception: { values: [{ value: "no person lena@acme.com" }] },
      breadcrumbs: [
        { category: "console", message: "[reminders] to lena@acme.com" },
        { category: "navigation", data: { from: "/invite/abc", to: "/w/acme" } },
      ],
    });
    expect(event.request?.url).toBe("https://app/g/…");
    expect(event.exception?.values?.[0]?.value).toBe("no person …@…");
    expect(event.breadcrumbs).toEqual([{ category: "navigation", data: { from: "/invite/…", to: "/w/acme" } }]);
    expect(scrubBreadcrumb({ category: "fetch", data: { url: "/api/g/tok/state" } })).toEqual({
      category: "fetch",
      data: { url: "/api/g/…/state" },
    });
  });

  it("leave out the requests a dropped connection stopped, and only those", () => {
    const ignored = (m: string) => BROWSER_NOISE.some((r) => r.test(m));
    for (const m of [
      "TypeError: Failed to fetch (app.joinronde.com)",
      "Failed to fetch",
      "TypeError: NetworkError when attempting to fetch resource.",
      "TypeError: Load failed",
    ])
      expect(ignored(m), m).toBe(true);
    for (const m of ["Error: Failed to fetch the meeting", "ChunkLoadError: Loading chunk 42 failed.", "TypeError: x is undefined"])
      expect(ignored(m), m).toBe(false);
  });
});
