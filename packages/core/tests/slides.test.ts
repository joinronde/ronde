import { agendaSchema } from "@ronde/core/agenda";
import { buildAgenda, limitOf } from "@ronde/core/meeting";
import { minutesMarkdown, recordDecisions } from "@ronde/core/minutes";
import { parseRecord } from "@ronde/core/record";
import type { MeetingDTO, MemberDTO } from "@ronde/core/types";
import { describe, expect, it } from "vitest";

// Slides of the agenda: a screen of their own between the other blocks (irritants right after the intro…)

const member = (id: string, name: string): MemberDTO => ({
  id,
  name,
  email: `${id}@example.com`,
  jobCategory: "Engineering",
  role: "participant",
  color: 0,
  position: 0,
  active: true,
  remind: true,
  gitlabUsername: null,
  githubUsername: null,
  birthday: null,
  avatarVer: null,
});
const members = { a: member("a", "Alice Martin"), b: member("b", "Bruno Petit") };
const meeting = (): MeetingDTO =>
  ({
    date: "2026-09-28",
    stepKey: "intro",
    order: ["a", "b"],
    projectOrder: [],
    projectsAdded: [],
    absent: [],
    spent: {},
    bonus: {},
    timer: { running: false, startedAt: null, baseMs: 0 },
  }) as unknown as MeetingDTO;

describe("slides in the agenda", () => {
  it("can appear several times, and a slide is irritants-free content unless said otherwise", () => {
    const parsed = agendaSchema.parse([
      { id: "intro", type: "intro" },
      { id: "s1", type: "slide", title: "Irritants", kind: "irritants" },
      { id: "round", type: "round" },
      { id: "s2", type: "slide", title: "Budget" },
    ]);
    expect(parsed[3]).toEqual({ id: "s2", type: "slide", title: "Budget", kind: "free" });
    expect(agendaSchema.safeParse([{ id: "s1", type: "slide", title: " " }]).success).toBe(false);
    expect(agendaSchema.safeParse([{ id: "s1", type: "slide", title: "X", kind: "poll" }]).success).toBe(false);
  });

  it("is a step of its own where it is placed, timed only when it has minutes", () => {
    const ag = buildAgenda(meeting(), members, [], "en", [
      { id: "intro", type: "intro" },
      { id: "s1", type: "slide", kind: "irritants", title: "Irritants", minutes: 5 },
      { id: "round", type: "round" },
      { id: "s2", type: "slide", kind: "free", title: "Budget" },
    ]);
    expect(ag.map((s) => [s.key, s.type, s.label])).toEqual([
      ["intro", "intro", "Intro"],
      ["s1", "block", "Irritants"],
      ["a", "speaker", "Alice Martin"],
      ["b", "speaker", "Bruno Petit"],
      ["s2", "block", "Budget"],
      ["end", "end", "Wrap-up"],
    ]);
    expect(ag[1]).toMatchObject({ block: "slide", blockId: "s1", limitMs: 5 * 60_000 });
    expect(ag[4]!.limitMs).toBeUndefined();
    expect(limitOf(meeting(), "s1", 120, ag[1])).toBe(5 * 60_000);
  });
});

describe("slides in the minutes", () => {
  const base = {
    date: "2026-09-21",
    teamName: "Product team",
    startedAt: 0,
    endedAt: 1_380_000,
    durationMs: 1_380_000,
    spent: {},
    participants: [
      { id: "a", name: "Alice Martin", jobCategory: "Design" },
      { id: "b", name: "Bruno Petit", jobCategory: "Design" },
    ],
    absent: [],
    updates: { a: { done: ["OIDC sign-in"], next: [], blockers: [], other: [] } },
    notes: { intro: "Welcome", s1: "Decision: no deploy on Fridays", s2: "Spent 80%" },
    interactions: [],
    topics: [],
    actions: [],
    names: { a: "Alice Martin", b: "Bruno Petit" },
    icebreaker: null,
    kudos: [],
  };
  const extra = {
    agenda: [
      { id: "intro", type: "intro" },
      { id: "s1", type: "slide", title: "Irritants", kind: "irritants" },
      { id: "round", type: "round" },
      { id: "s2", type: "slide", title: "Budget", kind: "free" },
    ],
    slides: [
      {
        blockId: "s1",
        items: [
          { text: "Builds take 40 min", byId: "a", tracked: true },
          { text: "Too many meetings", byId: null, tracked: false },
        ],
        actions: [{ text: "Cache the builds", ownerId: "b" }],
      },
      { blockId: "s2", body: "**Q3**: 80% spent" },
    ],
  };
  // Read as the first format, then given what the current one adds
  const r = parseRecord({ ...parseRecord(base)!, ...extra })!;
  const md = minutesMarkdown(r, "en");

  it("keeps what was raised, who raised it, and the actions decided there", () => {
    expect(md).toContain("## Irritants");
    expect(md).toContain("Alice Martin: Builds take 40 min · action created");
    expect(md).toContain("- Too many meetings\n");
    expect(md).toContain("**Actions decided**\n- Cache the builds (Bruno Petit)");
  });

  it("reads the slides in agenda order: those before the turns right after the intro, the others after the turns", () => {
    const at = (s: string) => md.indexOf(s);
    expect(at("## Intro")).toBeLessThan(at("## Irritants"));
    expect(at("## Irritants")).toBeLessThan(at("OIDC sign-in"));
    expect(at("OIDC sign-in")).toBeLessThan(at("## Budget"));
    expect(md).toContain("**Q3**: 80% spent");
  });

  it("names the slide a decision was taken on", () => {
    expect(recordDecisions(r, "en").map((d) => `${d.text} ${d.context}`)).toContain("no deploy on Fridays (Irritants)");
  });

  it("reads a closing slide after the open topics, before the actions", () => {
    const closing = parseRecord({
      ...parseRecord({
        ...base,
        topics: [{ text: "On-call rota", byId: null, done: true }],
        actions: [{ text: "Book the room", ownerId: "a", status: "open" }],
      })!,
      agenda: [
        { id: "intro", type: "intro" },
        { id: "round", type: "round" },
        { id: "topics", type: "topics" },
        { id: "s3", type: "slide", title: "Next steps", kind: "free" },
      ],
      slides: [{ blockId: "s3", body: "See you on Monday" }],
    })!;
    const text = minutesMarkdown(closing, "en");
    expect(text.indexOf("On-call rota")).toBeLessThan(text.indexOf("## Next steps"));
    expect(text.indexOf("## Next steps")).toBeLessThan(text.indexOf("Book the room"));
  });

  it("reads an older record without slides", () => {
    expect(parseRecord({ ...parseRecord(base)!, slides: undefined })!.slides).toEqual([]);
  });
});
