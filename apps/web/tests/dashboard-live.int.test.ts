import { prisma } from "@ronde/db";
import { describe, expect, it } from "vitest";
import { dashboard } from "@/lib/server/dashboard";
import { meeting, workspace } from "./fixtures";

// The home page's "Happening now": a session started early or late says when it really started

describe("a session going on", () => {
  it("shows the day and the hour it started, not the ones it was planned for", async () => {
    const f = await meeting(await workspace(`dash-live-${Date.now().toString(36)}`), "Weekly");
    // Planned in two days at 10:00, started an hour ago
    const planned = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const rule = await prisma.scheduleRule.findFirstOrThrow({ where: { meetingId: f.meetingId } });
    await prisma.scheduleRule.update({
      where: { id: rule.id },
      data: { startDate: planned, byDay: [new Date(`${planned}T12:00:00Z`).getUTCDay()] },
    });
    const started = new Date(Date.now() - 3_600_000);
    await prisma.session.update({
      where: { id: f.sessionId },
      data: { date: planned, occurrenceKey: `${rule.id}:${planned}`, startedAt: started, endedAt: null },
    });
    const data = await dashboard(f.ctx.ws);
    expect(data.next?.live).toBe(true);
    expect(data.next?.date).toBe(planned);
    // The workspace is on UTC
    expect(data.next?.progress).toMatchObject({
      startedDate: started.toISOString().slice(0, 10),
      startedTime: started.toISOString().slice(11, 16),
    });
  });
});
