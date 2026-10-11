import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { notifyEvent } from "@/lib/server/notify/dispatch";
import { encryptSecret } from "@/lib/server/secrets";

// Workflows: a rule sends only when its conditions hold, in the words the team wrote

const posts: string[] = [];
let meetingId = "";
let ruleId = "";
const minutes = (actions: number) => ({
  session: { date: "2026-10-05", time: "10:00" },
  minutes: {
    durationMs: 30 * 60_000,
    participants: 4,
    decisions: ["ship v2"],
    actions: Array.from({ length: actions }, (_, i) => ({ text: `Action ${i + 1}`, owner: "Ali" })),
  },
});

beforeAll(async () => {
  vi.stubEnv("APP_URL", "https://example.com/ronde");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      posts.push(String(init.body));
      return new Response("ok", { status: 200 });
    }),
  );
  const ws = await prisma.workspace.create({ data: { slug: `wf-${Date.now().toString(36)}`, name: "Workflows" } });
  const meeting = await prisma.meeting.create({ data: { workspaceId: ws.id, name: "Weekly" } });
  meetingId = meeting.id;
  const slack = await prisma.connector.create({
    data: { workspaceId: ws.id, kind: "slack", name: "Channel", secret: encryptSecret("https://hooks.slack.com/services/T0/B0/x") },
  });
  ruleId = (
    await prisma.notificationRule.create({
      data: {
        workspaceId: ws.id,
        meetingId,
        connectorId: slack.id,
        event: "minutes_published",
        conditions: [{ field: "openActions", op: ">", value: 0 }],
        message: { title: "{meeting}: follow-up needed", body: "Open actions:\n{actions}" },
      },
    })
  ).id;
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("workflows", () => {
  it("does not send when the conditions do not hold, and says so", async () => {
    await notifyEvent(meetingId, "minutes.published", "s1", minutes(0));
    expect(posts).toHaveLength(0);
    const d = await prisma.delivery.findFirstOrThrow({ where: { ruleId } });
    expect(d.status).toBe("skipped");
  });

  it("sends the team's own words when they hold", async () => {
    await notifyEvent(meetingId, "minutes.published", "s2", minutes(2));
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("Weekly: follow-up needed");
    expect(posts[0]).toContain("Action 2 (Ali)");
  });
});
