import type { NotifyInput } from "@ronde/core/notify";
import type { NotifyRuleDTO } from "@ronde/core/types";
import { describe, expect, it } from "vitest";
import { fillVariables, previewChannels, previewMessage } from "@/lib/shared/notify-preview";

// The preview of a meeting's notifications: it used to show the reminder email even with email turned off,
// and nothing of the other channels

const rule = (id: string, connectorId: string, enabled = true): NotifyRuleDTO => ({
  id,
  connectorId,
  event: "session.started",
  target: {},
  options: {},
  conditions: [],
  message: null,
  enabled,
});

const input: NotifyInput = {
  event: "session.started",
  settings: { teamName: "Product team", targetMin: 30, speakSec: 120, videoUrl: "", sections: [] },
  locale: "en",
  meetingUrl: "https://ronde.example/w/acme/m/1",
  session: { date: "2026-10-15", time: "10:00" },
};

describe("previewing a meeting's notifications", () => {
  it("shows the reminder email only when it is on, then each connector with a rule turned on", () => {
    const connectors = [
      { id: "slack", kind: "slack" as const, name: "#team" },
      { id: "mail", kind: "email" as const, name: "Email" },
      { id: "teams", kind: "teams" as const, name: "Teams" },
    ];
    const rules = [rule("a", "slack"), rule("b", "mail", false), rule("c", "slack")];
    expect(previewChannels(false, connectors, rules).map((c) => c.id)).toEqual(["slack"]);
    const on = previewChannels(true, connectors, rules);
    expect(on.map((c) => c.id)).toEqual(["reminder", "slack"]);
    expect(on[1]).toMatchObject({ kind: "slack", rules: [{ id: "a" }, { id: "c" }] });
    expect(previewChannels(false, connectors, [])).toEqual([]);
  });

  it("fills in the team's own words, leaving unknown variables as typed", () => {
    expect(fillVariables("{meeting} at {time} {nope}", { meeting: "Sync", time: "10:00" })).toBe("Sync at 10:00 {nope}");
    const custom = previewMessage(input, { title: "{meeting} has started", body: "Join at {time}" });
    expect(custom.summary).toBe("Product team has started");
    expect(custom.blocks).toEqual([
      { kind: "title", text: "Product team has started" },
      { kind: "text", text: "Join at 10:00" },
      { kind: "link", url: "https://ronde.example/w/acme/m/1", label: "Product team" },
    ]);
    // No title of its own: the event's
    expect(previewMessage(input, { title: "", body: "" }).summary).toBe(previewMessage(input, null).summary);
  });
});
