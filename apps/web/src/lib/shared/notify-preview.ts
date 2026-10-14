import { type NotifyInput, notifyMessage, type RichMessage, safeUrl } from "@ronde/core/notify";
import type { NotifyConnectorDTO, NotifyRuleDTO } from "@ronde/core/types";
import { workflowVariables } from "@ronde/core/workflows";

// What the notifications of a meeting will look like, channel by channel: the reminder email when it is on,
// then each connector with a rule turned on. Pure, for the server-free tests

/** A custom message's {variables} filled in; an unknown one stays as typed */
export const fillVariables = (text: string, vars: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? vars[name]! : whole));

/** The message a rule sends: the event's own, or the team's words when the rule has some */
export function previewMessage(input: NotifyInput, custom: { title: string; body: string } | null): RichMessage {
  const fallback = notifyMessage(input);
  if (!custom) return fallback;
  const vars = workflowVariables(input);
  const title = fillVariables(custom.title, vars).trim() || fallback.summary;
  const body = fillVariables(custom.body, vars).trim();
  const link = safeUrl(input.meetingUrl);
  return {
    summary: title,
    blocks: [
      { kind: "title", text: title },
      ...(body ? [{ kind: "text" as const, text: body }] : []),
      ...(link ? [{ kind: "link" as const, url: link, label: input.settings.teamName }] : []),
    ],
  };
}

export type PreviewChannel =
  | { id: "reminder"; kind: "reminder" }
  | { id: string; kind: NotifyConnectorDTO["kind"]; name: string; rules: NotifyRuleDTO[] };

/** The channels that will actually send something, in the order of the connectors */
export function previewChannels(reminderOn: boolean, connectors: NotifyConnectorDTO[], rules: NotifyRuleDTO[]): PreviewChannel[] {
  const out: PreviewChannel[] = reminderOn ? [{ id: "reminder", kind: "reminder" }] : [];
  for (const c of connectors) {
    const on = rules.filter((r) => r.connectorId === c.id && r.enabled);
    if (on.length) out.push({ id: c.id, kind: c.kind, name: c.name, rules: on });
  }
  return out;
}
