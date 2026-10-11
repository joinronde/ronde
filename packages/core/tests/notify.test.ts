import { describe, expect, it } from "vitest";
import { type NotifyInput, notifyMessage, toDiscord, toHtml, toMarkdown, toSlack, toTeams, toText } from "../src/notify";
import { DEFAULT_SECTIONS } from "../src/util";

const settings = {
  teamName: "Tools <team>",
  targetMin: 25,
  speakSec: 120,
  videoUrl: "https://meet.example.com/team",
  sections: DEFAULT_SECTIONS,
};
const base: Omit<NotifyInput, "event"> = {
  settings,
  locale: "en",
  meetingUrl: "https://app.example.com/w/acme/m/m1",
  session: { date: "2026-10-12", time: "14:00" },
};

describe("notification messages", () => {
  it("announces a session soon, with its time, the video link and the link to Ronde", () => {
    const m = notifyMessage({ ...base, event: "session.soon", minutesBefore: 10 });
    expect(m.summary).toBe("⏰ Tools <team> starts in 10 minutes");
    const text = toText(m);
    expect(text).toContain("When: Monday, October 12, 2026 at 14:00");
    expect(text).toContain("🎥 Join the video call: https://meet.example.com/team");
    expect(text).toContain("https://app.example.com/w/acme/m/m1/me");
  });

  it("is written in the meeting language", () => {
    expect(notifyMessage({ ...base, locale: "fr", event: "session.started" }).summary).toBe("▶️ Tools <team> commence");
    expect(notifyMessage({ ...base, locale: "fr", event: "checkin.reminder", progress: { ready: 1, total: 3 } }).blocks).toContainEqual({
      kind: "text",
      text: "Fiches prêtes : 1/3\n2 fiches restent à préparer ou à mettre à jour.",
    });
  });

  it("sums up the minutes, overdue actions and birthdays", () => {
    const minutes = toText(
      notifyMessage({
        ...base,
        event: "minutes.published",
        minutes: { durationMs: 23 * 60_000, participants: 5, decisions: ["Ship v2"], actions: [{ text: "Book the room", owner: "Ada" }] },
      }),
    );
    expect(minutes).toContain("Duration: 23 min");
    expect(minutes).toContain("• Ship v2");
    expect(minutes).toContain("• Book the room (Ada)");
    expect(minutes).toContain("https://app.example.com/w/acme/m/m1/history");
    expect(notifyMessage({ ...base, event: "action.overdue", overdue: [{ text: "Fix CI", owner: "Tom", days: 9 }] }).summary).toBe(
      "⏳ Tools <team>: 1 follow-up action is waiting",
    );
    expect(notifyMessage({ ...base, event: "birthday", names: ["Ada", "Tom"] }).summary).toBe("🎂 Happy birthday Ada and Tom!");
  });

  it("drops links that are not http(s)", () => {
    const m = notifyMessage({
      ...base,
      settings: { ...settings, videoUrl: "javascript:alert(1)" },
      meetingUrl: "",
      event: "session.started",
    });
    expect(m.blocks.some((b) => b.kind === "link")).toBe(false);
  });
});

describe("renderers", () => {
  const m = notifyMessage({ ...base, event: "session.soon", minutesBefore: 5 });

  it("escapes HTML (Matrix, email)", () => {
    expect(toHtml(m)).toContain("<strong>⏰ Tools &lt;team&gt; starts in 5 minutes</strong>");
    expect(toHtml(m)).not.toContain("<team>");
  });

  it("writes Slack mrkdwn with escaped text and <url|label> links", () => {
    const s = toSlack(m);
    expect(s.text).toBe(m.summary);
    expect(JSON.stringify(s.blocks)).toContain("*⏰ Tools &lt;team&gt; starts in 5 minutes*");
    expect(JSON.stringify(s.blocks)).toContain("<https://meet.example.com/team|🎥 Join the video call>");
  });

  it("writes Markdown with formatting characters escaped (Discord, Mattermost)", () => {
    const md = toMarkdown(notifyMessage({ ...base, settings: { ...settings, teamName: "Team *alpha*" }, event: "session.started" }));
    expect(md.split("\n")[0]).toBe("**▶️ Team \\*alpha\\* is starting**");
    expect(md).toContain("[🎥 Join the video call](https://meet.example.com/team)");
  });

  it("builds a Teams Adaptive Card and a Discord embed within limits", () => {
    const card = toTeams(m) as { attachments: { content: { body: { type: string }[]; actions: { url: string }[] } }[] };
    expect(card.attachments[0]!.content.body[0]).toMatchObject({ type: "TextBlock", weight: "Bolder" });
    expect(card.attachments[0]!.content.actions.map((a) => a.url)).toContain("https://meet.example.com/team");
    const embed = (toDiscord(m) as { embeds: { title: string; fields: unknown[] }[] }).embeds[0]!;
    expect(embed.title).toBe(m.summary);
    expect(embed.fields.length).toBe(2);
  });
});
