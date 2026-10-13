import type { ProjectHealth, ProjectStatus } from "@ronde/core/types";
import { describe, expect, it } from "vitest";
import {
  daysBetween,
  depthIn,
  fullName,
  hasHealth,
  heroSeats,
  MAX_DEPTH,
  peopleMatching,
  projectGroups,
  projectMatches,
  rootOf,
} from "@/lib/shared/workspace-lists";

// The workspace pages' lists: the directory search, the portfolio's filters and sections, programmes, and the
// seats around the next session

const person = (firstName: string, lastName: string, email: string, jobCategoryId: string | null = null) => ({
  firstName,
  lastName,
  email,
  jobCategoryId,
});
const categories = new Map([
  ["dev", "Développeur"],
  ["ops", "Ops"],
]);

describe("the directory search", () => {
  const people = [
    person("Alice", "Martin", "alice@example.com", "dev"),
    person("Bruno", "Silva", "bruno@example.com", "ops"),
    person("Léa", "", "lea@example.com"),
    person("Omar", "El-Amin", "omar@example.com"),
  ];

  it("shows everyone when nothing is typed", () => {
    expect(peopleMatching(people, "", categories)).toBe(people);
    expect(peopleMatching(people, "   ", categories)).toBe(people);
  });

  it("finds a name, an email or a job category, whatever the case", () => {
    expect(peopleMatching(people, "MARTIN", categories).map((p) => p.firstName)).toEqual(["Alice"]);
    expect(peopleMatching(people, "bruno@", categories).map((p) => p.firstName)).toEqual(["Bruno"]);
    expect(peopleMatching(people, "ops", categories).map((p) => p.firstName)).toEqual(["Bruno"]);
  });

  it("finds a full name typed with its space, and ignores the spaces around the query", () => {
    expect(peopleMatching(people, "  alice martin ", categories).map((p) => p.firstName)).toEqual(["Alice"]);
  });

  it("finds everyone sharing a part of their email", () => {
    expect(peopleMatching(people, "example.com", categories)).toHaveLength(4);
  });

  it("finds odd characters as they are typed", () => {
    expect(peopleMatching(people, "el-amin", categories).map((p) => p.firstName)).toEqual(["Omar"]);
    expect(peopleMatching(people, ".*", categories)).toEqual([]);
  });

  it("leaves accents aside, as every search of the app does", () => {
    expect(peopleMatching(people, "léa", categories).map((p) => p.firstName)).toEqual(["Léa"]);
    expect(peopleMatching(people, "LEA", categories).map((p) => p.firstName)).toEqual(["Léa"]);
    expect(peopleMatching(people, "developpeur", categories).map((p) => p.firstName)).toEqual(["Alice"]);
    expect(peopleMatching(people, "développeur", categories).map((p) => p.firstName)).toEqual(["Alice"]);
  });

  it("finds names in other scripts, right to left included", () => {
    const world = [person("ليلى", "حداد", "layla@example.com"), person("王", "芳", "wang@example.com")];
    expect(peopleMatching(world, "حداد", categories).map((p) => p.email)).toEqual(["layla@example.com"]);
    expect(peopleMatching(world, "王 芳", categories).map((p) => p.email)).toEqual(["wang@example.com"]);
  });

  it("shows nobody in an empty directory", () => {
    expect(peopleMatching([], "a", categories)).toEqual([]);
  });

  it("writes a name without a trailing space when the last name is missing", () => {
    expect(fullName({ firstName: "Léa", lastName: "" })).toBe("Léa");
    expect(fullName({ firstName: "", lastName: "" })).toBe("");
  });
});

type Proj = {
  id: string;
  name: string;
  summary: string;
  color: number;
  themeId: string | null;
  status: ProjectStatus;
  parentId: string | null;
  archived: boolean;
  mine: boolean;
  health: ProjectHealth | null;
};
const project = (id: string, patch: Partial<Proj> = {}): Proj => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  summary: "",
  color: 0,
  themeId: null,
  status: "active",
  parentId: null,
  archived: false,
  mine: false,
  health: null,
  ...patch,
});
const tree = (list: Proj[]) => new Map(list.map((p) => [p.id, p]));

describe("the top programme of a project", () => {
  it("is the project itself when it belongs to none", () => {
    expect(rootOf(tree([project("billing")]), "billing")).toBe("billing");
  });

  it("is the id asked for when the project is not known", () => {
    expect(rootOf(tree([]), "ghost")).toBe("ghost");
  });

  it("is found up the whole chain", () => {
    const byId = tree([project("platform"), project("payments", { parentId: "platform" }), project("refunds", { parentId: "payments" })]);
    expect(rootOf(byId, "refunds")).toBe("platform");
    expect(rootOf(byId, "payments")).toBe("platform");
  });

  it("stops at the highest programme the viewer can see", () => {
    // The parent is private and missing from the portfolio
    expect(rootOf(tree([project("payments", { parentId: "secret" })]), "payments")).toBe("payments");
  });

  it("does not loop forever on a cycle", () => {
    const byId = tree([project("a", { parentId: "b" }), project("b", { parentId: "a" })]);
    expect(["a", "b"]).toContain(rootOf(byId, "a"));
  });
});

describe("the depth of a project", () => {
  it("is 1 at the top, one more at each level", () => {
    const byId = tree([project("p"), project("c", { parentId: "p" }), project("g", { parentId: "c" })]);
    expect([depthIn(byId, "p"), depthIn(byId, "c"), depthIn(byId, "g")]).toEqual([1, 2, 3]);
    expect(depthIn(byId, "g")).toBe(MAX_DEPTH);
  });

  it("counts a parent the viewer cannot see, so a hidden programme still limits the choices", () => {
    expect(depthIn(tree([project("c", { parentId: "hidden" })]), "c")).toBe(2);
  });

  it("is 1 for a project not known", () => {
    expect(depthIn(tree([]), "ghost")).toBe(1);
  });

  it("stops one past the deepest level on a cycle or a too deep chain", () => {
    const loop = tree([project("a", { parentId: "b" }), project("b", { parentId: "a" })]);
    expect(depthIn(loop, "a")).toBe(MAX_DEPTH + 1);
    const deep = tree(["l0", "l1", "l2", "l3", "l4", "l5"].map((id, i) => project(id, { parentId: i ? `l${i - 1}` : null })));
    expect(depthIn(deep, "l5")).toBe(MAX_DEPTH + 1);
  });
});

describe("the portfolio filters", () => {
  const all = { status: "all" as const, mine: false, needle: "" };

  it("show the open projects by default, never the archived ones", () => {
    const open = { ...all, status: "open" as const };
    expect(projectMatches(project("a", { status: "proposed" }), open)).toBe(true);
    expect(projectMatches(project("a", { status: "paused" }), open)).toBe(true);
    expect(projectMatches(project("a", { status: "done" }), open)).toBe(false);
    expect(projectMatches(project("a", { status: "cancelled" }), open)).toBe(false);
    expect(projectMatches(project("a", { archived: true }), open)).toBe(false);
  });

  it("show every project, archived ones included, with 'all'", () => {
    expect(projectMatches(project("a", { status: "done", archived: true }), all)).toBe(true);
  });

  it("show one status without its archived projects", () => {
    expect(projectMatches(project("a", { status: "done" }), { ...all, status: "done" })).toBe(true);
    expect(projectMatches(project("a", { status: "done", archived: true }), { ...all, status: "done" })).toBe(false);
    expect(projectMatches(project("a"), { ...all, status: "done" })).toBe(false);
  });

  it("keep only the viewer's projects with 'mine'", () => {
    expect(projectMatches(project("a", { mine: true }), { ...all, mine: true })).toBe(true);
    expect(projectMatches(project("a"), { ...all, mine: true })).toBe(false);
  });

  it("find the text in the name or the summary", () => {
    const p = project("billing", { name: "Billing v2", summary: "Invoices (EU) & refunds" });
    expect(projectMatches(p, { ...all, needle: "v2" })).toBe(true);
    expect(projectMatches(p, { ...all, needle: "(eu) & ref" })).toBe(true);
    expect(projectMatches(p, { ...all, needle: "payroll" })).toBe(false);
  });

  it("find the text whatever its accents", () => {
    const p = project("refonte", { name: "Refonte de l'équipe", summary: "Données client" });
    expect(projectMatches(p, { ...all, needle: "equipe" })).toBe(true);
    expect(projectMatches(p, { ...all, needle: "DONNEES" })).toBe(true);
  });

  it("filter by health, 'none' for a project with none yet, blank for all", () => {
    const green = project("a", { health: "onTrack" });
    const unknown = project("b");
    expect(hasHealth(green, "")).toBe(true);
    expect(hasHealth(unknown, "")).toBe(true);
    expect(hasHealth(green, "onTrack")).toBe(true);
    expect(hasHealth(green, "offTrack")).toBe(false);
    expect(hasHealth(unknown, "none")).toBe(true);
    expect(hasHealth(green, "none")).toBe(false);
  });
});

describe("the portfolio sections", () => {
  const t = (k: string) => `[${k}]`;
  const themes = [
    { id: "growth", name: "Growth", description: "New users", color: 2 },
    { id: "core", name: "Core", description: "", color: 4 },
  ];

  it("are the themes, then the projects in none", () => {
    const projects = [
      project("a", { themeId: "core" }),
      project("b"),
      project("c", { themeId: "growth" }),
      project("d", { themeId: "core" }),
    ];
    const groups = projectGroups("theme", { themes, projects }, projects, t);
    expect(groups.map((g) => [g.key, g.title, g.color, g.items.map((p) => p.id)])).toEqual([
      ["growth", "Growth", 2, ["c"]],
      ["core", "Core", 4, ["a", "d"]],
      ["none", "[noTheme]", null, ["b"]],
    ]);
    expect(groups[0]!.sub).toBe("New users");
  });

  it("keep a theme with no project (the page hides empty sections)", () => {
    const groups = projectGroups("theme", { themes, projects: [] }, [], t);
    expect(groups.map((g) => g.items.length)).toEqual([0, 0, 0]);
  });

  it("put a project of a theme that no longer exists in no section", () => {
    const projects = [project("a", { themeId: "deleted" })];
    expect(projectGroups("theme", { themes, projects }, projects, t).flatMap((g) => g.items)).toEqual([]);
  });

  it("list only the projects shown, not the whole portfolio", () => {
    const projects = [project("a", { themeId: "core" }), project("b", { themeId: "core" })];
    const groups = projectGroups("theme", { themes, projects }, [projects[1]!], t);
    expect(groups[1]!.items.map((p) => p.id)).toEqual(["b"]);
  });

  it("are one per status, in the order of the statuses", () => {
    const projects = [project("a", { status: "done" }), project("b", { status: "proposed" }), project("c")];
    const groups = projectGroups("status", { themes, projects }, projects, t);
    expect(groups.map((g) => [g.key, g.title, g.items.map((p) => p.id)])).toEqual([
      ["proposed", "[status.proposed]", ["b"]],
      ["active", "[status.active]", ["c"]],
      ["paused", "[status.paused]", []],
      ["done", "[status.done]", ["a"]],
      ["cancelled", "[status.cancelled]", []],
    ]);
  });

  it("are one per programme with what it holds at any level, then the projects in none", () => {
    const projects = [
      project("platform", { summary: "All of it", color: 3 }),
      project("payments", { parentId: "platform" }),
      project("refunds", { parentId: "payments" }),
      project("mobile"),
      project("web", { parentId: "mobile" }),
      project("alone"),
    ];
    const groups = projectGroups("programme", { themes, projects }, projects, t);
    expect(groups.map((g) => [g.key, g.title, g.items.map((p) => p.id)])).toEqual([
      ["platform", "Platform", ["platform", "payments", "refunds"]],
      ["mobile", "Mobile", ["mobile", "web"]],
      ["none", "[noProgramme]", ["alone"]],
    ]);
    expect(groups[0]).toMatchObject({ sub: "All of it", color: 3 });
  });

  it("treat a project under a programme the viewer cannot see as a top one", () => {
    // Its parent is private (members only): the project used to be in no section at all
    const alone = [project("payments", { parentId: "secret" })];
    expect(projectGroups("programme", { themes, projects: alone }, alone, t).map((g) => [g.key, g.items.map((p) => p.id)])).toEqual([
      ["none", ["payments"]],
    ]);
    // ...and when it holds projects of its own, it is their programme
    const chain = [project("payments", { parentId: "secret" }), project("refunds", { parentId: "payments" })];
    expect(projectGroups("programme", { themes, projects: chain }, chain, t).map((g) => [g.key, g.items.map((p) => p.id)])).toEqual([
      ["payments", ["payments", "refunds"]],
      ["none", []],
    ]);
  });

  it("keep a programme whose own projects are all filtered out", () => {
    const projects = [project("platform"), project("payments", { parentId: "platform", status: "done" })];
    const groups = projectGroups("programme", { themes, projects }, [projects[0]!], t);
    expect(groups[0]!.items.map((p) => p.id)).toEqual(["platform"]);
  });

  it("hold fifty projects without losing any", () => {
    const projects = Array.from({ length: 50 }, (_, i) =>
      project(`p${i}`, { themeId: i % 3 ? "core" : null, status: (["proposed", "active", "done"] as const)[i % 3]! }),
    );
    for (const g of ["theme", "status"] as const)
      expect(new Set(projectGroups(g, { themes, projects }, projects, t).flatMap((x) => x.items)).size).toBe(50);
  });
});

describe("days to the next session", () => {
  it("are 0 today, 1 tomorrow, negative in the past", () => {
    expect(daysBetween("2026-10-13", "2026-10-13")).toBe(0);
    expect(daysBetween("2026-10-13", "2026-10-14")).toBe(1);
    expect(daysBetween("2026-10-14", "2026-10-13")).toBe(-1);
  });

  it("cross months, leap days and years", () => {
    expect(daysBetween("2026-01-31", "2026-03-01")).toBe(29);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("stay whole across a change of summer time, in any time zone", () => {
    const zone = process.env.TZ;
    try {
      for (const tz of ["Europe/Paris", "America/New_York", "Australia/Sydney", "Pacific/Kiritimati", "UTC"]) {
        process.env.TZ = tz;
        // Europe and the US go to winter time; Sydney to summer time
        expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
        expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
        expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
      }
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it("are not a number for a date that is not one", () => {
    expect(daysBetween("", "2026-10-13")).toBeNaN();
  });
});

describe("the seats around the next session", () => {
  const people = (...ids: string[]) => ids.map((id) => ({ id }));

  it("put the ready people first, each group in its order", () => {
    const { seats } = heroSeats(people("a", "b", "c", "d", "e"), new Set(["d", "b"]));
    expect(seats.map((p) => p.id)).toEqual(["b", "d", "a", "c", "e"]);
  });

  it("show eight seats at most and count the others", () => {
    const many = people(...Array.from({ length: 50 }, (_, i) => `p${i}`));
    const { seats, more } = heroSeats(many, new Set(["p49"]));
    expect(seats).toHaveLength(8);
    expect(seats[0]!.id).toBe("p49");
    expect(more).toBe(42);
  });

  it("do not change the list they are given", () => {
    const list = people("a", "b");
    heroSeats(list, new Set(["b"]));
    expect(list.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("close the ring once everyone is ready, leave it empty when nobody is", () => {
    expect(heroSeats(people("a", "b"), new Set(["a", "b"])).share).toBe(1);
    expect(heroSeats(people("a", "b"), new Set()).share).toBe(0);
  });

  it("end the arc halfway to the first seat not ready", () => {
    expect(heroSeats(people("a", "b", "c", "d"), new Set(["a"])).share).toBe(0.125);
    expect(heroSeats(people("a", "b", "c", "d"), new Set(["a", "b", "c"])).share).toBe(0.625);
  });

  it("count only the ready people shown: ten ready of twelve close the ring of eight", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const { share, more } = heroSeats(people(...ids), new Set(ids.slice(0, 10)));
    expect(share).toBe(1);
    expect(more).toBe(4);
  });

  it("ignore ready people who are not invited", () => {
    expect(heroSeats(people("a"), new Set(["ghost"])).share).toBe(0);
  });

  it("are none at an empty table, whose ring the page leaves empty", () => {
    expect(heroSeats([], new Set())).toEqual({ seats: [], more: 0, share: 1 });
  });

  it("seat one person once", () => {
    expect(heroSeats(people("a"), new Set(["a"]))).toEqual({ seats: [{ id: "a" }], more: 0, share: 1 });
  });
});
