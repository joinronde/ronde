import { REMINDER_LOGO_CID } from "@ronde/core/notifications";
import { DEFAULT_SECTIONS } from "@ronde/core/util";
import { prisma } from "@ronde/db";
import nodemailer from "nodemailer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { checkReminders, zonedClock } from "@/lib/server/reminders";

// Reminders read the real schema: participants, check-ins, the last archived session and open actions

let meetingId = "";

beforeAll(async () => {
  vi.stubEnv("APP_URL", "https://example.com/ronde");
  vi.stubEnv("SMTP_URL", "smtp://localhost");
  const ws = await prisma.workspace.create({ data: { slug: "tools", name: "Tools", timezone: "Europe/Paris" } });
  const workspaceId = ws.id;
  const person = (firstName: string, lastName: string) =>
    prisma.person.create({ data: { workspaceId, firstName, lastName, email: `${firstName.toLowerCase()}@example.com` } });
  const [empty, ready, stale, absent] = await Promise.all([
    person("Ines", "Moreau"),
    person("Ali", "Martin"),
    person("Lou", "Garnier"),
    person("Sam", "Absent"),
  ]);
  const meeting = await prisma.meeting.create({
    data: { workspaceId, name: "Tools team", reminderEnabled: true, reminderWhen: "sameDay", reminderTime: "09:00" },
  });
  meetingId = meeting.id;
  await prisma.section.createMany({
    data: DEFAULT_SECTIONS.map((s, position) => ({
      workspaceId,
      meetingId,
      key: s.key,
      label: s.label,
      role: s.role,
      input: s.input,
      position,
    })),
  });
  await prisma.meetingParticipant.createMany({
    data: [empty, ready, stale, absent].map((p, position) => ({ workspaceId, meetingId, personId: p.id, position })),
  });
  const archived = await prisma.session.create({
    data: {
      workspaceId,
      meetingId,
      date: "2026-09-24",
      status: "archived",
      archivedAt: new Date("2026-09-24T15:00:00Z"),
      record: { updates: { [empty.id]: { next: ["[ ] Prepare the demo"] } } },
    },
  });
  // What Ines planned at that session
  await prisma.checkInItem.create({
    data: {
      workspaceId,
      meetingId,
      personId: empty.id,
      sessionId: archived.id,
      sectionKey: "next",
      role: "plan",
      text: "[ ] Prepare the demo",
    },
  });
  await prisma.session.create({ data: { workspaceId, meetingId, date: "2026-10-01", time: "14:00", absent: [absent.id] } });
  await prisma.checkIn.createMany({
    data: [
      { workspaceId, meetingId, personId: ready.id },
      { workspaceId, meetingId, personId: stale.id },
    ],
  });
  await prisma.checkInItem.createMany({
    data: [
      { workspaceId, meetingId, personId: ready.id, sectionKey: "done", role: "achievement", text: "Shipped" },
      { workspaceId, meetingId, personId: stale.id, sectionKey: "done", role: "achievement", text: "Old check-in" },
    ],
  });
  // The stale check-in was last saved before the last session was archived
  await prisma.$executeRaw`UPDATE "CheckIn" SET "updatedAt" = '2026-09-23T12:00:00Z' WHERE "personId" = ${stale.id}`;
  await prisma.$executeRaw`UPDATE "CheckIn" SET "updatedAt" = '2026-09-30T12:00:00Z' WHERE "personId" = ${ready.id}`;
  await prisma.action.create({ data: { workspaceId, meetingId, ownerId: empty.id, text: "Test the deployment", status: "doing" } });
});

describe("reminders", () => {
  it("reads the clock in the meeting's time zone", () => {
    expect(zonedClock(new Date("2026-10-01T06:30:00Z"), "Europe/Paris")).toEqual({ date: "2026-10-01", minutes: 8 * 60 + 30 });
    expect(zonedClock(new Date("2026-10-01T02:00:00Z"), "America/New_York")).toEqual({ date: "2026-09-30", minutes: 22 * 60 });
  });

  it("waits for the reminder time, local to the meeting", async () => {
    // 08:30 in Paris: before 09:00
    expect(await checkReminders(new Date("2026-10-01T06:30:00Z"))).toBe(0);
  });

  it("attaches the inline logo and only reminds people whose check-in is not ready, once", async () => {
    // In-memory transport: checks the full MIME without sending any email
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    const send = vi.spyOn(transport, "sendMail");
    vi.spyOn(nodemailer, "createTransport").mockReturnValue(transport);
    expect(await checkReminders(new Date("2026-10-01T10:00:00Z"))).toBe(2);
    expect(send.mock.calls.map(([mail]) => mail.to).sort()).toEqual(["ines@example.com", "lou@example.com"]);
    const ines = send.mock.calls.find(([mail]) => mail.to === "ines@example.com")![0];
    expect(ines.text).toContain("Prepare the demo");
    expect(ines.text).toContain("Test the deployment (In progress)");
    expect(ines.text).toContain(`https://example.com/ronde/w/tools/m/${meetingId}/me`);
    const mime = (await send.mock.results[0]!.value).message.toString();
    expect(mime).toContain(`Content-ID: <${REMINDER_LOGO_CID}>`);
    expect(mime).toContain("Content-Disposition: inline");
    expect(mime).toContain("multipart/alternative");
    // Sent once per session, even if checked again (or by another replica)
    expect(await checkReminders(new Date("2026-10-01T10:05:00Z"))).toBe(0);
  });
});
