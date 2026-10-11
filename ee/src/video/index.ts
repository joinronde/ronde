// Ronde Enterprise Edition. Copyright (c) Ronde. Licensed under the Ronde Enterprise License (see ee/LICENSE).
import type { EnterpriseEdition, VideoAccess } from "@ronde/editions/ee";
import { call as base, bearer, googleToken, graphToken, graphUser } from "../providers";

// Video links: a lasting Zoom, Google Meet or Microsoft Teams room for each meeting, created with an account
// of the workspace (no sign-in per person): Zoom Server-to-Server OAuth, a Google service account with
// domain-wide delegation, a Microsoft Entra application with the OnlineMeetings permission.

export { ProviderError as VideoError } from "../providers";

const call = (a: VideoAccess, url: string, init: RequestInit = {}) => base(a.fetch, url, init);
const json = (token: string, body?: unknown) => bearer(token, body === undefined ? "GET" : "POST", body);

// ---------- Zoom: Server-to-Server OAuth ----------

async function zoomToken(a: VideoAccess): Promise<string> {
  const basic = Buffer.from(`${a.config.clientId}:${a.secret}`).toString("base64");
  const r = await call(
    a,
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(a.config.accountId ?? "")}`,
    {
      method: "POST",
      headers: { authorization: `Basic ${basic}` },
    },
  );
  return String(r.access_token);
}

const googleMeetToken = (a: VideoAccess) =>
  googleToken(a, a.config.subject ?? "", "https://www.googleapis.com/auth/meetings.space.created");

export async function createRoom(a: VideoAccess, meeting: { topic: string; timezone: string }): Promise<{ url: string; id: string }> {
  switch (a.kind) {
    case "zoom": {
      // A recurring meeting with no fixed time: one join link that works for every session
      const r = await call(
        a,
        "https://api.zoom.us/v2/users/me/meetings",
        json(await zoomToken(a), {
          topic: meeting.topic,
          type: 3,
          timezone: meeting.timezone,
          settings: { join_before_host: true, waiting_room: false, mute_upon_entry: true },
        }),
      );
      return { url: String(r.join_url), id: String(r.id) };
    }
    case "meet": {
      const r = await call(
        a,
        "https://meet.googleapis.com/v2/spaces",
        json(await googleMeetToken(a), { config: { accessType: "TRUSTED" } }),
      );
      return { url: String(r.meetingUri), id: String(r.name) };
    }
    case "teams": {
      // Without a fixed series, the meeting stays open for a year from now
      const start = new Date();
      const end = new Date(start.getTime() + 365 * 86_400_000);
      const r = await call(
        a,
        `${graphUser(a.config.organizer ?? "")}/onlineMeetings`,
        json(await graphToken(a), { subject: meeting.topic, startDateTime: start.toISOString(), endDateTime: end.toISOString() }),
      );
      return { url: String(r.joinWebUrl), id: String(r.id) };
    }
  }
}

export async function test(a: VideoAccess): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (a.kind === "zoom") await call(a, "https://api.zoom.us/v2/users/me", json(await zoomToken(a)));
    else if (a.kind === "meet") await googleMeetToken(a);
    else await call(a, graphUser(a.config.organizer ?? ""), json(await graphToken(a)));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const video: EnterpriseEdition["video"] = { createRoom, test };
