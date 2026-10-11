// Ronde Enterprise Edition. Copyright (c) Ronde. Licensed under the Ronde Enterprise License (see ee/LICENSE).

import type { AiAction, AiConfig, AiInput, EnterpriseEdition } from "@ronde/editions/ee";
import type { Locale } from "@ronde/i18n";

// The AI assistant: drafts the summary of a session and suggests follow-up actions, with the Anthropic API.
// The key belongs to the workspace (or the instance); the minutes are sent, nothing else.

const API = "https://api.anthropic.com/v1/messages";
const LANGUAGE: Record<Locale, string> = {
  en: "English",
  zh: "Simplified Chinese",
  hi: "Hindi",
  es: "Spanish",
  ar: "Arabic",
  fr: "French",
  pt: "Portuguese",
  ru: "Russian",
  de: "German",
  it: "Italian",
};

export class AiError extends Error {
  constructor(
    readonly code: "aiKey" | "aiUnavailable" | "aiAnswer",
    message: string,
  ) {
    super(message);
  }
}

async function ask(config: AiConfig, system: string, user: string, maxTokens: number): Promise<string> {
  const res = await (config.fetch ?? fetch)(API, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: config.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401 || res.status === 403) throw new AiError("aiKey", `the provider refused the key (${res.status})`);
  if (!res.ok) throw new AiError("aiUnavailable", `the provider answered ${res.status}`);
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (body.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();
  if (!text) throw new AiError("aiAnswer", "empty answer");
  return text;
}

const minutesBlock = (input: AiInput) =>
  `Meeting: ${input.meeting}\n\n<minutes>\n${input.minutes.slice(0, 60_000)}\n</minutes>${input.transcript ? `\n\n<transcript>\n${input.transcript.slice(0, 120_000)}\n</transcript>` : ""}`;

export async function summarize(input: AiInput, config: AiConfig): Promise<string> {
  return ask(
    config,
    `You write the summary of a team meeting from its minutes. Write in ${LANGUAGE[input.locale]}, in Markdown: ` +
      "a short paragraph of what matters, then the decisions and the risks as bullet lists when there are some. " +
      "Stick to the minutes and, when there is one, the transcript of what was said: invent nothing, name people only as they do. No title, no preamble.",
    minutesBlock(input),
    1200,
  );
}

/** Reads the first JSON array of an answer */
function jsonArray(text: string): unknown[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw new AiError("aiAnswer", "no list in the answer");
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (Array.isArray(value)) return value;
  } catch {}
  throw new AiError("aiAnswer", "unreadable list");
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

export async function suggestActions(input: AiInput & { people: { id: string; name: string }[] }, config: AiConfig): Promise<AiAction[]> {
  const answer = await ask(
    config,
    `You read the minutes of a team meeting and list the follow-up actions they call for: blockers to remove, things someone said they would do. Write each action in ${LANGUAGE[input.locale]}, short, starting with a verb. ` +
      'Answer with a JSON array only: [{"text": "...", "owner": "first name of the person who should do it, or null"}]. ' +
      "At most 8 actions; an empty array when there is none. Invent nothing.",
    `${minutesBlock(input)}\n\nParticipants: ${input.people.map((p) => p.name).join(", ")}`,
    1000,
  );
  // An owner is kept only when the name matches one participant, by full or first name
  const owner = (name: unknown): string | null => {
    if (typeof name !== "string" || !name.trim()) return null;
    const n = fold(name);
    const found = input.people.filter((p) => fold(p.name) === n || fold(p.name).split(/\s+/)[0] === n);
    return found.length === 1 ? found[0]!.id : null;
  };
  return jsonArray(answer)
    .flatMap((x) => {
      const item = x as { text?: unknown; owner?: unknown };
      return typeof item.text === "string" && item.text.trim()
        ? [{ text: item.text.trim().slice(0, 300), ownerId: owner(item.owner) }]
        : [];
    })
    .slice(0, 8);
}

export const ai: EnterpriseEdition["ai"] = { summarize, suggestActions };
