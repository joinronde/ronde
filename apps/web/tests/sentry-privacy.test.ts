import { describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubEvent, scrubText } from "@/lib/shared/sentry-privacy";

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
});
