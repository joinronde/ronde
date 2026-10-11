// Why a wiki refused, kept as "code" or "code:detail" (the page's last error, an action's answer), in words

export const WIKI_ERRORS = ["token", "notionPage", "notionParent", "confluenceSpace", "answer", "network"] as const;
export type WikiErrorKey = (typeof WIKI_ERRORS)[number];

/** The stored form of a wiki's refusal */
export function wikiErrorOf(e: unknown): string {
  const code = (e as { code?: string })?.code;
  const detail = String((e as { detail?: string })?.detail ?? (e instanceof Error ? e.message : e) ?? "");
  const known = WIKI_ERRORS.includes(code as WikiErrorKey) ? (code as WikiErrorKey) : "answer";
  return `${known}${detail ? `:${detail}` : ""}`.slice(0, 300);
}

/** Its code and what the wiki said, to translate with wikis.errors.<code> */
export function readWikiError(stored: string): { code: WikiErrorKey; detail: string } {
  const at = stored.indexOf(":");
  const code = (at < 0 ? stored : stored.slice(0, at)) as WikiErrorKey;
  const detail = at < 0 ? "" : stored.slice(at + 1);
  return WIKI_ERRORS.includes(code) ? { code, detail } : { code: "answer", detail: stored };
}
