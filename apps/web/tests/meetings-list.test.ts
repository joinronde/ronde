import { describe, expect, it } from "vitest";
import { liveFirst, sortMeetings } from "@/lib/shared/meetings-list";

// A meeting going on right now used to sit wherever it fell in the lists: it is now on top of them

const m = (name: string, patch: Partial<Parameters<typeof sortMeetings>[0][number]> = {}) => ({
  name,
  next: null,
  lastHeld: null,
  openActions: 0,
  ...patch,
});

describe("the list of meetings", () => {
  it("puts the live meetings first, keeping the order of the others", () => {
    const list = [
      { id: "a", live: false },
      { id: "b", live: true },
      { id: "c", live: false },
      { id: "d", live: true },
    ];
    expect(liveFirst(list, (x) => x.live).map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("sorts by next session (none last), name, last held or open actions, live always on top", () => {
    const list = [
      m("Zeta", { next: { date: "2026-10-20", time: "10:00", live: false }, lastHeld: "2026-10-01", openActions: 1 }),
      m("Alpha", { lastHeld: "2026-10-10", openActions: 5 }),
      m("Beta", { next: { date: "2026-10-15", time: "09:00", live: false }, openActions: 2 }),
      m("Live", { next: { date: "2026-10-14", time: "14:00", live: true } }),
    ];
    const names = (sort: Parameters<typeof sortMeetings>[1]) => sortMeetings(list, sort).map((x) => x.name);
    expect(names("next")).toEqual(["Live", "Beta", "Zeta", "Alpha"]);
    expect(names("name")).toEqual(["Live", "Alpha", "Beta", "Zeta"]);
    expect(names("recent")).toEqual(["Live", "Alpha", "Zeta", "Beta"]);
    expect(names("actions")).toEqual(["Live", "Alpha", "Beta", "Zeta"]);
  });
});
