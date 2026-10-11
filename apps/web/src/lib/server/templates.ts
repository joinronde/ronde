import "server-only";
import { agendaOf } from "@ronde/core/agenda";
import type { ScheduleRule } from "@ronde/core/schedule";
import {
  BUILTIN_TEMPLATES,
  builtinTemplate,
  describeRhythm,
  isBuiltinTemplate,
  parseTemplate,
  type RulePattern,
  TEMPLATE_CATEGORY,
  TEMPLATE_ICONS,
  type TemplateCategory,
  type TemplateData,
} from "@ronde/core/templates";
import { resolveSections } from "@ronde/core/util";
import type { Prisma, ScopedClient, ScopedTx } from "@ronde/db";
import { type Locale, translator } from "@ronde/i18n";
import { newRoom } from "@ronde/modules";
import type { WorkspaceContext } from "./authz";
import { AccessError, OpError } from "./errors";
import { toSection } from "./meeting/dto";
import { ALL_MODULES, moduleAllowed } from "./meeting/modules";

type Db = ScopedClient | ScopedTx;

/** A template as the creation wizard shows it */
export interface TemplateSummary {
  /** "builtin:weekly" or the id of a workspace template */
  ref: string;
  builtin: boolean;
  name: string;
  description: string;
  icon: string;
  /** Who it is for; "own" for the templates the workspace saved */
  category: TemplateCategory | "own";
  data: TemplateData;
  /** Section labels, in the viewer's language */
  sections: string[];
  /** Schedule pattern in plain words */
  schedule: string;
  /** The viewer may delete it (workspace templates) */
  canDelete: boolean;
}

/** Rules of a schedule pattern, from a first date */
export const rulesFrom = (patterns: RulePattern[], startDate: string): ScheduleRule[] =>
  patterns.map((p, i) => ({ ...p, id: String(i), startDate, until: null, count: null }));

/** Everything that shapes a meeting, without its people, its history or any secret */
export async function meetingTemplate(db: Db, meetingId: string): Promise<TemplateData> {
  const [meeting, sections, modules, rules] = await Promise.all([
    db.meeting.findFirstOrThrow({ where: { id: meetingId } }),
    db.section.findMany({ where: { meetingId }, orderBy: { position: "asc" } }),
    db.moduleInstallation.findMany({ where: { meetingId } }),
    db.scheduleRule.findMany({ where: { meetingId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
  ]);
  return {
    v: 1,
    settings: {
      targetMin: meeting.targetMin,
      speakSec: meeting.speakSec,
      autoStart: meeting.autoStart,
      hostLabel: meeting.hostLabel,
      announcements: meeting.announcements,
      reminderEnabled: meeting.reminderEnabled,
      reminderWhen: meeting.reminderWhen === "sameDay" ? "sameDay" : "dayBefore",
      reminderTime: meeting.reminderTime,
    },
    sections: sections.map(toSection),
    // Module settings only: their secrets (tokens) and the video room stay with the meeting
    modules: Object.fromEntries(
      modules.map((m) => [
        m.moduleId,
        {
          enabled: m.enabled,
          config: m.moduleId === "video" && m.config ? { ...(m.config as object), room: "" } : (m.config ?? undefined),
        },
      ]),
    ),
    schedule: rules.length
      ? rules.map((r) => ({
          freq: r.freq,
          interval: r.interval,
          byDay: r.byDay,
          setPos: r.setPos,
          monthDay: r.monthDay,
          time: r.time,
          durationMin: r.durationMin,
        }))
      : builtinTemplate("weekly", "en").schedule,
    ...(meeting.agenda ? { agenda: agendaOf(meeting.agenda) } : {}),
  };
}

/** Built-in templates, then the workspace's own */
export async function listTemplates(ctx: WorkspaceContext, locale: Locale): Promise<TemplateSummary[]> {
  const t = translator(locale, "templates");
  const summary = (data: TemplateData) => ({
    sections: resolveSections({ sections: data.sections }, locale).map((s) => s.label),
    // A template gives a rhythm, not a date: the team picks its day and time when creating the meeting
    schedule: describeRhythm(data.schedule, locale),
  });
  const builtins = BUILTIN_TEMPLATES.map((id): TemplateSummary => {
    const data = builtinTemplate(id, locale);
    return {
      ref: `builtin:${id}`,
      builtin: true,
      name: t(`${id}.name`),
      description: t(`${id}.description`),
      icon: TEMPLATE_ICONS[id],
      category: TEMPLATE_CATEGORY[id],
      data,
      ...summary(data),
      canDelete: false,
    };
  });
  const rows = await ctx.db.template.findMany({ orderBy: { createdAt: "asc" } });
  const own = rows.flatMap((r): TemplateSummary[] => {
    const data = parseTemplate(r.data);
    if (!data) return [];
    return [
      {
        ref: r.id,
        builtin: false,
        name: r.name,
        description: r.description,
        icon: r.icon,
        category: "own",
        data,
        ...summary(data),
        canDelete: canManageTemplate(ctx, r.createdById),
      },
    ];
  });
  return [...builtins, ...own];
}

/** Admins manage every template; members, the ones they saved */
const canManageTemplate = (ctx: WorkspaceContext, createdById: string | null) =>
  ctx.can("templates.manage") && (ctx.can("workspace.manage") || createdById === ctx.user.id);

/** The template behind a reference: built-in ("builtin:<id>") or saved by the workspace */
export async function resolveTemplate(ctx: WorkspaceContext, ref: string, locale: Locale): Promise<TemplateData> {
  if (ref.startsWith("builtin:")) {
    const id = ref.slice(8);
    if (!isBuiltinTemplate(id)) throw new OpError("notFound");
    return builtinTemplate(id, locale);
  }
  const row = await ctx.db.template.findFirst({ where: { id: ref } });
  const data = row && parseTemplate(row.data);
  if (!data) throw new OpError("notFound");
  return data;
}

/** The emoji a meeting made from a template starts with: the template's own */
export async function templateIcon(ctx: WorkspaceContext, ref: string): Promise<string> {
  if (ref.startsWith("builtin:")) {
    const id = ref.slice(8);
    return isBuiltinTemplate(id) ? TEMPLATE_ICONS[id] : "";
  }
  return (await ctx.db.template.findFirst({ where: { id: ref }, select: { icon: true } }))?.icon ?? "";
}

export async function saveTemplate(
  db: Db,
  ids: { workspaceId: string; meetingId: string; userId: string },
  input: { name: string; description: string; icon: string },
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) throw new OpError("nameRequired");
  const data = await meetingTemplate(db, ids.meetingId);
  return db.template.create({
    data: {
      workspaceId: ids.workspaceId,
      name,
      description: input.description.trim(),
      icon: input.icon.trim() || "📋",
      data: data as unknown as Prisma.InputJsonObject,
      createdById: ids.userId,
    },
    select: { id: true },
  });
}

export async function deleteTemplate(ctx: WorkspaceContext, id: string): Promise<void> {
  const row = await ctx.db.template.findFirst({ where: { id }, select: { createdById: true } });
  if (!row) throw new OpError("notFound");
  if (!canManageTemplate(ctx, row.createdById)) throw new AccessError(403, "accessDenied");
  await ctx.db.template.delete({ where: { id } });
}

/** Module installations of a new meeting from a template: the template's choices over the defaults */
export function installationsFrom(
  data: TemplateData,
  base: { workspaceId: string; meetingId: string; moduleId: string; enabled: boolean; config: object }[],
  overrides: Record<string, boolean> = {},
) {
  return base.map((row) => {
    const mod = ALL_MODULES.find((m) => m.id === row.moduleId);
    const fromTemplate = data.modules[row.moduleId];
    const config =
      fromTemplate?.config !== undefined && mod?.config.schema.safeParse(fromTemplate.config).success ? fromTemplate.config : row.config;
    const enabled = overrides[row.moduleId] ?? fromTemplate?.enabled ?? row.enabled;
    // Each meeting has its own video room
    const own = row.moduleId === "video" ? { ...(config as object), room: newRoom() } : config;
    return { ...row, enabled: !!mod && moduleAllowed(mod) && enabled, config: own as object };
  });
}
