import { BLOCK_MODULE } from "@ronde/core/agenda";
import {
  BUILTIN_TEMPLATES,
  blankTemplate,
  builtinTemplate,
  describeRhythm,
  parseSections,
  parseTemplate,
  sectionsProblem,
  TEMPLATE_CATEGORY,
  templateData,
} from "@ronde/core/templates";
import { locales } from "@ronde/i18n";
import { describe, expect, it } from "vitest";

describe("built-in templates", () => {
  it.each(BUILTIN_TEMPLATES)("%s is a valid template in every language", (id) => {
    // Every language of the interface: a missing or broken translation would show up here
    for (const locale of locales) {
      const t = builtinTemplate(id, locale);
      expect(templateData.safeParse(t).success).toBe(true);
      expect(new Set(t.sections.map((s) => s.key)).size).toBe(t.sections.length);
      // Named sections get a label in each language, the others the default of their role
      for (const s of t.sections) if (s.label) expect(s.label).not.toMatch(/\./);
    }
  });

  it("names sections in the workspace language", () => {
    expect(builtinTemplate("standup", "fr").sections.map((s) => s.label)).toEqual(["Hier", "Aujourd'hui", ""]);
  });

  it("asks how useful the meeting was only where it fits", () => {
    const rated = BUILTIN_TEMPLATES.filter((id) => builtinTemplate(id, "en").modules.rating?.enabled !== false);
    // Not every day, not between two people (the average would tell), not in the official record of a formal body
    for (const id of [
      "standup",
      "shiftHandover",
      "serviceBriefing",
      "oneOnOne",
      "onboarding",
      "steering",
      "board",
      "boardOfDirectors",
    ] as const)
      expect(rated).not.toContain(id);
    for (const id of ["weekly", "retro", "sprintReview", "allHands", "teachingTeam", "volunteers"] as const) expect(rated).toContain(id);
  });

  it("brings sections the meeting's settings accept, and the module of each agenda block", () => {
    for (const id of BUILTIN_TEMPLATES) {
      const t = builtinTemplate(id, "en");
      // A role held twice or a custom section without a name would refuse every later save of the sections
      expect(sectionsProblem(t.sections), id).toBeNull();
      // A retro or a planning poker block without its module would be a step nobody can run
      for (const block of t.agenda ?? []) {
        const module = BLOCK_MODULE[block.type];
        if (module) expect(t.modules[module]?.enabled, `${id}: ${module}`).toBe(true);
      }
    }
  });

  it("plans a sprint every other week: the goal, what is ready, who is there, the risks, then planning poker", () => {
    const t = builtinTemplate("sprintPlanning", "en");
    expect(TEMPLATE_CATEGORY.sprintPlanning).toBe("product");
    expect(t.sections.map((s) => [s.label, s.role, s.input])).toEqual([
      ["Sprint goal", "note", "text"],
      ["Ready items", "custom", "list"],
      ["Capacity and absences", "custom", "text"],
      ["Risks", "blocker", "list"],
    ]);
    // Estimating takes the place of the round table
    expect(t.agenda?.map((b) => b.type)).toEqual(["intro", "poker", "topics"]);
    expect(t.modules.poker).toEqual({ enabled: true });
    expect(describeRhythm(t.schedule, "en").replace(/\s/g, " ")).toBe("Every other week · 1 hr");
    expect(builtinTemplate("sprintPlanning", "fr").sections.map((s) => s.label)).toEqual([
      "Objectif du sprint",
      "Éléments prêts",
      "Capacité et absences",
      "Risques",
    ]);
  });

  it("refuses what is not a template", () => {
    expect(parseTemplate({ v: 1, sections: [] })).toBeNull();
    expect(parseTemplate(builtinTemplate("weekly", "en"))).not.toBeNull();
  });
});

describe("template rhythm", () => {
  // Intl separates numbers and units with non-breaking spaces
  const rhythm = (...a: Parameters<typeof describeRhythm>) => describeRhythm(...a).replace(/\s/g, " ");
  it("says how often and how long, never a day, a time or a time zone", () => {
    expect(rhythm(builtinTemplate("weekly", "en").schedule, "en")).toBe("Every week · 30 min");
    expect(rhythm(builtinTemplate("standup", "en").schedule, "en")).toBe("Every working day · 15 min");
    expect(rhythm(builtinTemplate("portfolio", "fr").schedule, "fr")).toBe("Une semaine sur deux · 1 h");
    expect(rhythm(builtinTemplate("classCouncil", "fr").schedule, "fr")).toBe("Une fois par trimestre · 1 h 30 min");
    // A handover at each change of shift, morning and evening
    expect(rhythm(builtinTemplate("shiftHandover", "en").schedule, "en")).toBe("Every day · 15 min");
    expect(rhythm(builtinTemplate("shiftHandover", "fr").schedule, "fr")).toBe("Chaque jour · 15 min");
  });
});

describe("a meeting started from nothing", () => {
  it("has the three usual lists and every module given turned off", () => {
    const data = blankTemplate(["mood", "kudos"]);
    expect(data.sections.map((s) => s.role)).toEqual(["achievement", "plan", "blocker"]);
    expect(data.modules).toEqual({ mood: { enabled: false }, kudos: { enabled: false } });
    expect(templateData.safeParse(data).success).toBe(true);
  });

  it("takes the sections picked in the wizard only when they can be filed", () => {
    const ok = [{ key: "done", role: "achievement", input: "list", label: "" }];
    expect(parseSections(ok)).toEqual(ok);
    expect(parseSections([])).toBeNull();
    expect(parseSections([...ok, ...ok])).toBeNull();
    expect(parseSections([{ key: "Bad key", role: "custom", input: "list", label: "" }])).toBeNull();
  });
});
