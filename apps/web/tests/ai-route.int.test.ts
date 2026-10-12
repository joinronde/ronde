import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MeetingCtx } from "@/lib/server/meeting/context";
import { type Fixture, meeting, workspace } from "./fixtures";

// The AI assistant on an archived session (Team): a draft summary, and follow-up actions with their owner found
// among the participants; what leaves for the provider is in the audit log. Against a fake Anthropic API.

let current: MeetingCtx;
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/meeting/context", async (original) => {
  const real = await original<typeof import("@/lib/server/meeting/context")>();
  return { ...real, requireMeeting: async () => current };
});

const { POST } = await import("@/app/api/w/[ws]/m/[meeting]/ai/route");

const asked: { model: string; system: string; user: string }[] = [];
let answer = "";
let f: Fixture;
const DATE = "2026-09-28";

beforeAll(async () => {
  vi.stubEnv("RONDE_CLOUD", "1");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-instance");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url !== "https://api.anthropic.com/v1/messages") throw new Error(`unexpected ${url}`);
      const b = JSON.parse(String(init.body)) as { model: string; system: string; messages: { content: string }[] };
      asked.push({ model: b.model, system: b.system, user: b.messages[0]!.content });
      return Response.json({ content: [{ type: "text", text: answer }] });
    }),
  );
  f = await meeting(await workspace(`ai-${Date.now().toString(36)}`), "Weekly");
  const host = await prisma.person.findUniqueOrThrow({ where: { id: f.hostPersonId } });
  await prisma.session.create({
    data: {
      workspaceId: f.workspaceId,
      meetingId: f.meetingId,
      date: DATE,
      status: "archived",
      record: {
        v: 1,
        date: DATE,
        teamName: "Weekly",
        startedAt: null,
        endedAt: null,
        durationMs: 1_800_000,
        spent: {},
        participants: [{ id: host.id, name: "Host", jobCategory: "" }],
        absent: [],
        sections: [{ key: "blockers", label: "", role: "blocker", input: "list" }],
        checkIns: { [host.id]: { items: [{ id: "i1", section: "blockers", text: "Waiting for staging access" }] } },
        notes: {},
        interactions: [],
        topics: [],
        actions: [],
        names: { [host.id]: "Host" },
      },
    },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** The route on that plan, the assistant turned on in the workspace's settings */
async function ask(task: "summary" | "actions", plan = "team") {
  current = {
    ...f.ctx,
    ws: {
      ...f.ctx.ws,
      workspace: { ...f.ctx.ws.workspace, plan, settings: { ai: { enabled: true, model: "claude-sonnet-5-5", key: "" } } },
    },
  };
  const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ task, date: DATE }) }), {
    params: Promise.resolve({ ws: f.ctx.ws.workspace.slug, meeting: f.meetingId }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("AI assistant", () => {
  it("drafts a summary from the minutes, and says so in the audit log", async () => {
    answer = "The team is blocked on staging access.";
    expect(await ask("summary")).toEqual({ status: 200, body: { summary: "The team is blocked on staging access." } });
    expect(asked.at(-1)).toMatchObject({ model: "claude-sonnet-5-5", user: expect.stringContaining("Waiting for staging access") });
    expect(await prisma.auditLog.count({ where: { workspaceId: f.workspaceId, action: "ai.summary" } })).toBe(1);
  });

  it("suggests follow-up actions, their owner found among the participants", async () => {
    answer = 'Here they are: [{"text": "Ask IT for staging access", "owner": "Host"}, {"text": "Write the release notes", "owner": null}]';
    const { status, body } = await ask("actions");
    expect(status).toBe(200);
    expect(body.actions).toEqual([
      expect.objectContaining({ text: "Ask IT for staging access", ownerId: f.hostPersonId }),
      expect.objectContaining({ text: "Write the release notes", ownerId: null }),
    ]);
  });

  it("is refused without the Team plan, and sends nothing", async () => {
    const before = asked.length;
    expect(await ask("summary", "community")).toMatchObject({ status: 403 });
    expect(asked).toHaveLength(before);
  });
});
