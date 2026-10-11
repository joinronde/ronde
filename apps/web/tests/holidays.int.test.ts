import { localDate } from "@ronde/core/schedule";
import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { guessHolidays, holidaysOf, isHolidayCode, publicHolidays } from "@/lib/server/holidays";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { updateWorkspace } from "@/lib/server/workspaces";
import { type Fixture, meeting, workspace } from "./fixtures";

// Public holidays skip the sessions that fall on them: the next one is prepared instead, the schedule says which
// holiday, and the host may still hold or move it. Dates come from today, so the test holds any day of the year.

const today = localDate(Date.now(), "Europe/Paris");
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (iso: string) => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
// The next French public holiday on a working day, more than a week ahead
const ahead = publicHolidays("FR", addDays(today, 8), addDays(today, 400), "fr");
const [holiday, name] = [...ahead].find(([d]) => weekdayOf(d) <= 5)!;
/** First date of the weekly rule after the holiday that is not a holiday itself */
let after = addDays(holiday, 7);
while (ahead.has(after)) after = addDays(after, 7);

const weekly = {
  freq: "weekly" as const,
  interval: 1,
  byDay: [weekdayOf(holiday)],
  setPos: null,
  monthDay: null,
  startDate: holiday,
  until: null,
  count: null,
  time: "10:00",
  durationMin: 30,
};

let f: Fixture;
const current = () => prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "current" } });
const first = async () => (await loadSnapshot(f.ctx)).settings.schedule.upcoming.find((o) => o.originalDate === holiday)!;

beforeAll(async () => {
  f = await meeting(await workspace("holidays"), "Weekly");
  // A French workspace: French holidays, named in French
  await prisma.workspace.update({
    where: { id: f.workspaceId },
    data: { locale: "fr", timezone: "Europe/Paris", settings: { holidays: "FR" } },
  });
  Object.assign(f.ctx.ws.workspace, { locale: "fr", timezone: "Europe/Paris", settings: { holidays: "FR" } });
  await prisma.session.deleteMany({ where: { meetingId: f.meetingId } });
  // The schedule starts on the holiday: the first session would fall on it
  await runOp(f.ctx, { op: "schedule.save", timeZone: "", rules: [weekly] });
});

describe("holiday calendars", () => {
  it("knows countries and their regions, and the country of a time zone", () => {
    expect([isHolidayCode("FR"), isHolidayCode("DE-BY"), isHolidayCode("XX"), isHolidayCode("DE-ZZ"), isHolidayCode("fr")]).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(guessHolidays("Europe/Paris")).toBe("FR");
    expect(guessHolidays("Mars/Olympus")).toBeNull();
    expect(publicHolidays("FR", "2026-12-01", "2026-12-31", "fr").get("2026-12-25")).toBe("Noël");
    // A meeting follows its workspace, unless it chose otherwise
    expect(holidaysOf({ holidays: null }, { settings: { holidays: "FR" } })).toBe("FR");
    expect(holidaysOf({ holidays: "none" }, { settings: { holidays: "FR" } })).toBeNull();
    expect(holidaysOf({ holidays: "DE-BY" }, { settings: {} })).toBe("DE-BY");
  });
});

describe("sessions skip public holidays", () => {
  it("prepares the next date instead, and the schedule says which holiday", async () => {
    expect((await current()).date).toBe(after);
    expect(await first()).toMatchObject({ date: holiday, cancelled: true, holiday: name });
  });

  it("can still be held, then skipped again", async () => {
    await runOp(f.ctx, { op: "schedule.keep", key: (await first()).key });
    expect((await current()).date).toBe(holiday);
    expect(await first()).toMatchObject({ cancelled: false, kept: true, holiday: name });
    await runOp(f.ctx, { op: "schedule.restore", key: (await first()).key });
    expect((await current()).date).toBe(after);
  });

  it("can be moved to another day", async () => {
    const key = (await first()).key;
    await runOp(f.ctx, { op: "schedule.move", key, date: addDays(holiday, 1), time: null, durationMin: null });
    expect((await current()).date).toBe(addDays(holiday, 1));
    await runOp(f.ctx, { op: "schedule.restore", key });
    expect((await current()).date).toBe(after);
  });

  it("follows the meeting's own choice, then the workspace's again", async () => {
    await runOp(f.ctx, { op: "schedule.holidays", value: "none" });
    expect((await current()).date).toBe(holiday);
    await expect(runOp(f.ctx, { op: "schedule.holidays", value: "XX" })).rejects.toThrow("invalidRequest");
    await runOp(f.ctx, { op: "schedule.holidays", value: null });
    expect((await current()).date).toBe(after);
  });

  it("moves the planned sessions along when the workspace stops skipping holidays", async () => {
    await updateWorkspace(f.ctx.ws, {
      name: "holidays",
      slug: f.ctx.ws.workspace.slug,
      locale: "fr",
      timezone: "Europe/Paris",
      meetingCreation: "members",
      holidays: "",
    });
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings).not.toHaveProperty("holidays");
    expect((await current()).date).toBe(holiday);
  });
});
