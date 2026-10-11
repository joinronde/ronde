import { generateKeyPairSync } from "node:crypto";
import type { CalendarAccess } from "@ronde/editions/ee";
import { describe, expect, it } from "vitest";
import { busy, remove, upsert } from "../src/calendar";

// Calendars: sessions written as events with their attendees, busy times read back

type Call = { url: string; init: RequestInit };
const fake = (answers: { status?: number; body: unknown }[]) => {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers[calls.length - 1] ?? { body: {} };
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
};
const event = {
  title: "Weekly",
  description: "Round table",
  start: "2030-01-07T09:00:00.000Z",
  end: "2030-01-07T09:30:00.000Z",
  attendees: ["emma@acme.com", "lucas@acme.com"],
  location: "https://zoom.us/j/42",
};
const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("calendars", () => {
  it("creates then updates a Google event for the organizer, inviting the attendees", async () => {
    const f = fake([{ body: { access_token: "g" } }, { body: { id: "ev1" } }, { body: { access_token: "g" } }, { body: { id: "ev1" } }]);
    const a: CalendarAccess = {
      kind: "google",
      config: { clientEmail: "sa@x.iam.gserviceaccount.com", organizer: "rooms@acme.com" },
      secret: key,
      fetch: f.fetch,
    };
    expect(await upsert(a, event)).toBe("ev1");
    expect(f.calls[1]!.url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all");
    expect(JSON.parse(String(f.calls[1]!.init.body))).toMatchObject({
      summary: "Weekly",
      attendees: [{ email: "emma@acme.com" }, { email: "lucas@acme.com" }],
    });
    await upsert(a, event, "ev1");
    expect([f.calls[3]!.init.method, f.calls[3]!.url]).toEqual([
      "PUT",
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/ev1?sendUpdates=all",
    ]);
  });

  it("writes Outlook events in UTC, and accepts an event already removed", async () => {
    const f = fake([{ body: { access_token: "m" } }, { body: { id: "o1" } }, { body: { access_token: "m" } }, { status: 404, body: {} }]);
    const a: CalendarAccess = {
      kind: "microsoft",
      config: { tenant: "t", clientId: "c", organizer: "rooms@acme.com" },
      secret: "s",
      fetch: f.fetch,
    };
    expect(await upsert(a, event)).toBe("o1");
    expect(f.calls[1]!.url).toBe("https://graph.microsoft.com/v1.0/users/rooms%40acme.com/events");
    expect(JSON.parse(String(f.calls[1]!.init.body))).toMatchObject({ start: { dateTime: "2030-01-07T09:00:00.000", timeZone: "UTC" } });
    await expect(remove(a, "o1")).resolves.toBeUndefined();
  });

  it("reads busy times from both providers, as UTC instants", async () => {
    const g = fake([
      { body: { access_token: "g" } },
      { body: { calendars: { "emma@acme.com": { busy: [{ start: "2030-01-07T10:00:00+01:00", end: "2030-01-07T11:00:00+01:00" }] } } } },
    ]);
    const ga: CalendarAccess = {
      kind: "google",
      config: { clientEmail: "sa@x", organizer: "rooms@acme.com" },
      secret: key,
      fetch: g.fetch,
    };
    expect(await busy(ga, ["emma@acme.com"], { from: "2030-01-07T00:00:00Z", to: "2030-01-08T00:00:00Z" })).toEqual({
      "emma@acme.com": [{ start: "2030-01-07T09:00:00.000Z", end: "2030-01-07T10:00:00.000Z" }],
    });
    const m = fake([
      { body: { access_token: "m" } },
      {
        body: {
          value: [
            {
              scheduleId: "Lucas@acme.com",
              scheduleItems: [
                { status: "busy", start: { dateTime: "2030-01-07T09:00:00.0000000" }, end: { dateTime: "2030-01-07T09:30:00.0000000" } },
                { status: "free", start: { dateTime: "2030-01-07T12:00:00" }, end: { dateTime: "2030-01-07T13:00:00" } },
              ],
            },
          ],
        },
      },
    ]);
    const ma: CalendarAccess = {
      kind: "microsoft",
      config: { tenant: "t", clientId: "c", organizer: "rooms@acme.com" },
      secret: "s",
      fetch: m.fetch,
    };
    expect(await busy(ma, ["lucas@acme.com"], { from: "2030-01-07T00:00:00Z", to: "2030-01-08T00:00:00Z" })).toEqual({
      "lucas@acme.com": [{ start: "2030-01-07T09:00:00.000Z", end: "2030-01-07T09:30:00.000Z" }],
    });
  });
});
