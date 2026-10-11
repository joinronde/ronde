import { describe, expect, it } from "vitest";
import { AiError, suggestActions, summarize } from "../src/ai";

// The AI assistant: what is sent to the provider, and how its answers are read

const reply = (text: string, status = 200) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status });
  }) as unknown as typeof fetch;
  return { calls, config: { apiKey: "sk-test", model: "claude-sonnet-5-5", fetch: fake } };
};

const input = { meeting: "Weekly", minutes: "## Blockers\n- Emma: no access to staging", locale: "en" as const };

describe("AI assistant", () => {
  it("sends the minutes with the workspace key and model, and returns the summary", async () => {
    const { calls, config } = reply("The team is blocked on staging access.");
    expect(await summarize(input, config)).toBe("The team is blocked on staging access.");
    const body = JSON.parse(String(calls[0]!.init.body)) as { model: string; messages: { content: string }[]; system: string };
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.messages[0]!.content).toContain("no access to staging");
    expect(body.system).toContain("English");
  });

  it("keeps an owner only when the name matches one participant", async () => {
    const { config } = reply(
      'Here you go: [{"text": "Get staging access", "owner": "emma"}, {"text": "Book a room", "owner": "Someone"}, {"text": "", "owner": null}]',
    );
    const actions = await suggestActions(
      {
        ...input,
        people: [
          { id: "p1", name: "Emma Laurent" },
          { id: "p2", name: "Lucas Martin" },
        ],
      },
      config,
    );
    expect(actions).toEqual([
      { text: "Get staging access", ownerId: "p1" },
      { text: "Book a room", ownerId: null },
    ]);
  });

  it("says when the key is refused, or the answer cannot be read", async () => {
    await expect(summarize(input, reply("", 401).config)).rejects.toMatchObject({ code: "aiKey" });
    await expect(suggestActions({ ...input, people: [] }, reply("No idea").config)).rejects.toBeInstanceOf(AiError);
  });
});
