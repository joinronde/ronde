// Workflows (Team): conditions on what an event carries, and messages written by the team.
// The figures and words of each event are computed here; checking and rendering belong to the paid edition.

import { formatters } from "@ronde/i18n";
import { z } from "zod";
import type { NotifyEvent, NotifyInput } from "./notify";

export const WORKFLOW_OPS = [">", ">=", "<", "<=", "=", "!="] as const;
export type WorkflowOp = (typeof WORKFLOW_OPS)[number];

/** Figures a condition can test, for each event ("weekday": 1 Monday … 7 Sunday, of the session) */
export const WORKFLOW_FIELDS = {
  "session.soon": ["weekday"],
  "session.started": ["weekday"],
  "checkin.reminder": ["ready", "missing", "readyPercent", "weekday"],
  "minutes.published": ["durationMin", "decisions", "openActions", "participants", "weekday"],
  "action.overdue": ["overdue", "maxDays"],
  birthday: ["people"],
} as const satisfies Record<NotifyEvent, readonly string[]>;
export type WorkflowField = (typeof WORKFLOW_FIELDS)[NotifyEvent][number];
export const ALL_WORKFLOW_FIELDS = [...new Set(Object.values(WORKFLOW_FIELDS).flat())] as WorkflowField[];

/** Words a custom message can use, in braces: "{meeting} starts at {time}" */
export const WORKFLOW_VARIABLES = [
  "meeting",
  "date",
  "time",
  "link",
  "ready",
  "total",
  "missing",
  "decisions",
  "actions",
  "duration",
  "names",
] as const;

export const workflowCondition = z.object({
  field: z.enum(ALL_WORKFLOW_FIELDS as [WorkflowField, ...WorkflowField[]]),
  op: z.enum(WORKFLOW_OPS),
  value: z.number().min(0).max(100_000),
});
export type WorkflowCondition = z.infer<typeof workflowCondition>;

export const workflowMessage = z.object({
  title: z.string().trim().max(160),
  body: z.string().trim().max(2000),
});
export type WorkflowMessage = z.infer<typeof workflowMessage>;

const weekday = (date: string | undefined) => (date ? ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1 : 0);

/** The figures of an event, for its conditions */
export function workflowFacts(input: NotifyInput): Record<WorkflowField, number> {
  const ready = input.progress?.ready ?? 0;
  const total = input.progress?.total ?? 0;
  return {
    weekday: weekday(input.session?.date),
    ready,
    missing: Math.max(0, total - ready),
    readyPercent: total ? Math.round((ready / total) * 100) : 100,
    durationMin: Math.round((input.minutes?.durationMs ?? 0) / 60_000),
    decisions: input.minutes?.decisions.length ?? 0,
    openActions: input.minutes?.actions.length ?? 0,
    participants: input.minutes?.participants ?? 0,
    overdue: input.overdue?.length ?? 0,
    maxDays: Math.max(0, ...(input.overdue ?? []).map((o) => o.days)),
    people: input.names?.length ?? 0,
  };
}

/** The words of an event, for its custom message */
export function workflowVariables(input: NotifyInput): Record<(typeof WORKFLOW_VARIABLES)[number], string> {
  const f = formatters(input.locale);
  const facts = workflowFacts(input);
  return {
    meeting: input.settings.teamName,
    date: input.session ? f.date(input.session.date) : "",
    time: input.session?.time ?? "",
    link: input.meetingUrl,
    ready: String(facts.ready),
    total: String(input.progress?.total ?? 0),
    missing: String(facts.missing),
    decisions: (input.minutes?.decisions ?? []).map((d) => `- ${d}`).join("\n"),
    actions: (input.minutes?.actions ?? input.overdue ?? []).map((a) => `- ${a.text}${a.owner ? ` (${a.owner})` : ""}`).join("\n"),
    duration: input.minutes ? `${facts.durationMin} min` : "",
    names: f.list(input.names ?? []),
  };
}
