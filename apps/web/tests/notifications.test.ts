import { notificationCheckInUrl, reminderEmail } from "@ronde/core/notifications";
import { afterEach, describe, expect, it, vi } from "vitest";

const settings = {
  teamName: "Tools team",
  targetMin: 25,
  speakSec: 120,
  videoUrl: "https://meet.example.com/team",
  sections: [
    { key: "done", label: "Our progress", role: "achievement" as const, input: "list" as const },
    { key: "next", label: "", role: "plan" as const, input: "list" as const },
    { key: "blockers", label: "", role: "blocker" as const, input: "list" as const },
    { key: "research", label: "Tech watch", role: "custom" as const, input: "list" as const },
  ],
};
const input = {
  settings,
  locale: "en" as const,
  date: "2026-10-01",
  time: "14:00",
  name: "Ines Moreau",
  checkInUrl: "https://ronde.example.com/ronde/me",
  planned: ["[x] Ship the new version"],
  actions: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("notification templates", () => {
  it("keeps the Ronde prefix and drops unusable links", () => {
    expect(notificationCheckInUrl("https://example.com/ronde/")).toBe("https://example.com/ronde/me");
    expect(notificationCheckInUrl("https://example.com/ronde?test=1#top")).toBe("https://example.com/ronde/me");
    for (const url of ["", "javascript:alert(1)", "/ronde", "not a URL"]) expect(notificationCheckInUrl(url)).toBe("");
  });

  it("includes the configured sections and the open actions in both versions", () => {
    const mail = reminderEmail({
      ...input,
      actions: [
        { text: "Prepare the demo", status: "doing" },
        { text: "Already resolved", status: "done" },
      ],
    });
    for (const content of [mail.text, mail.html]) {
      expect(content).toContain("Our progress");
      expect(content).toContain("Tech watch");
      expect(content).toContain("Ship the new version");
      expect(content).toContain("In progress");
      expect(content).not.toContain("[x]");
      expect(content).not.toContain("Already resolved");
      expect(content).not.toContain("Other");
    }
    const empty = reminderEmail({ ...input, checkInUrl: "", settings: { ...settings, videoUrl: "" }, planned: [] });
    expect(empty.text).toContain("My screen");
    expect(empty.html).not.toContain("<a ");
    expect(empty.html).not.toContain("What you planned at the last meeting");
    expect(empty.html).not.toContain("Your follow-up actions");
  });

  it("is written in the team language", () => {
    const mail = reminderEmail({ ...input, locale: "fr" });
    expect(mail.subject).toBe("Ronde · Tools team : votre fiche pour jeudi 1 octobre à 14:00");
    expect(mail.text).toContain("Bonjour Ines,");
    expect(mail.html).toContain('<html lang="fr" dir="ltr">');
    // Arabic reads right to left, the arrow of the button too
    const ar = reminderEmail({ ...input, locale: "ar" });
    expect(ar.html).toContain('<html lang="ar" dir="rtl">');
    expect(ar.html).toContain("←</a>");
  });

  it("shows input as text and neutralises dangerous active links", () => {
    const malicious = '<img src=x onerror="alert(1)">';
    const mail = reminderEmail({
      ...input,
      name: malicious,
      planned: [malicious],
      checkInUrl: "javascript:alert(1)",
      settings: { ...settings, teamName: malicious, videoUrl: "data:text/html,test" },
    });
    expect(mail.text).toContain(malicious);
    expect(mail.html).not.toContain(malicious);
    expect(mail.html).toContain("&lt;img");
    expect(mail.html).not.toContain("javascript:");
    expect(mail.html).not.toContain("data:text/html");
  });
});
