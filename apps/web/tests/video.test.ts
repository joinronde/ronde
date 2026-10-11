import { describe, expect, it, vi } from "vitest";
import { bbbCall, bbbJoin } from "@/lib/server/video";

// BigBlueButton: signed API calls, opening the room, joining with the right role

describe("bbbCall", () => {
  it("signs the call like the BigBlueButton documentation example", () => {
    const url = bbbCall("https://bbb.example.com/bigbluebutton/", "639259d4-9dd8-4b25-bf01-95f9567eaf4b", "create", {
      name: "Test Meeting",
      meetingID: "abc123",
      attendeePW: "111222",
      moderatorPW: "333444",
    });
    expect(url).toBe(
      "https://bbb.example.com/bigbluebutton/api/create?name=Test+Meeting&meetingID=abc123&attendeePW=111222&moderatorPW=333444&checksum=1fcbb0c4fc1f039f73aa6d697d2db9ba7f803f17",
    );
    // Entered with "/api" or without: the same base
    expect(bbbCall("https://bbb.example.com/bigbluebutton/api", "s", "join", {})).toMatch(
      /^https:\/\/bbb\.example\.com\/bigbluebutton\/api\/join\?/,
    );
  });
});

describe("bbbJoin", () => {
  const base = { server: "https://bbb.test/bigbluebutton", secret: "s3cret", room: "Room42", name: "Weekly", person: "Ana Lima" };

  it("opens the room, then joins hosts as moderators and the others as viewers", async () => {
    const fetcher = vi.fn(async () => new Response("<response><returncode>SUCCESS</returncode></response>"));
    const host = new URL(await bbbJoin({ ...base, moderator: true }, fetcher as unknown as typeof fetch));
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toContain("/api/create?name=Weekly&meetingID=ronde-Room42");
    expect(host.pathname).toBe("/bigbluebutton/api/join");
    expect(host.searchParams.get("fullName")).toBe("Ana Lima");
    expect(host.searchParams.get("role")).toBe("MODERATOR");
    const viewer = new URL(await bbbJoin({ ...base, moderator: false }, fetcher as unknown as typeof fetch));
    expect(viewer.searchParams.get("role")).toBe("VIEWER");
  });

  it("fails when the server refuses", async () => {
    const fetcher = vi.fn(
      async () => new Response("<response><returncode>FAILED</returncode><messageKey>checksumError</messageKey></response>"),
    );
    await expect(bbbJoin({ ...base, moderator: false }, fetcher as unknown as typeof fetch)).rejects.toThrow("checksumError");
  });
});
