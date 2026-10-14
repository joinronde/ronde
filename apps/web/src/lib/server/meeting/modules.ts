import "server-only";
import type { ScopedClient, ScopedTx } from "@ronde/db";
import { hasFeature } from "@ronde/editions";
import { type Locale, translator } from "@ronde/i18n";
import type { ModuleDef } from "@ronde/module-sdk";
import { MODULES } from "@ronde/modules";
import { edition } from "../license";

type Db = ScopedClient | ScopedTx;

export const ALL_MODULES = MODULES as readonly ModuleDef[];

/** The module is included in the instance's edition */
export const moduleAllowed = (mod: Pick<ModuleDef, "feature">) => hasFeature(edition(), mod.feature);

export interface ModuleState {
  enabled: boolean;
  /** Saved configuration (merged over the defaults by the module itself) */
  config: unknown;
  /** Encrypted secret, never sent to the browser */
  secret: string;
}

/** State of every module for a meeting: what is saved, otherwise the module defaults */
export async function moduleStates(db: Db, meetingId: string): Promise<Record<string, ModuleState>> {
  return moduleStatesFrom(await db.moduleInstallation.findMany({ where: { meetingId } }));
}

export function moduleStatesFrom(
  rows: { moduleId: string; enabled: boolean; config: unknown; secret: string }[],
): Record<string, ModuleState> {
  return Object.fromEntries(
    ALL_MODULES.map((mod) => {
      const row = rows.find((r) => r.moduleId === mod.id);
      return [
        mod.id,
        {
          enabled: moduleAllowed(mod) && (row ? row.enabled : mod.defaultEnabled),
          config: row?.config ?? mod.config.defaults,
          secret: row?.secret ?? "",
        },
      ];
    }),
  );
}

/** The icebreaker questions a meeting starts with, in its language */
export function defaultIcebreakerBank(locale: Locale): string[] {
  const t = translator(locale, "defaults");
  return (["win", "tool", "smile", "eager", "skill", "bug"] as const).map((k) => t(`icebreakers.${k}`));
}

/** Modules of a new meeting, configured in the workspace language (the icebreaker questions…) */
export function defaultInstallations(workspaceId: string, meetingId: string, locale: Locale) {
  const bank = defaultIcebreakerBank(locale);
  return ALL_MODULES.map((mod) => ({
    workspaceId,
    meetingId,
    moduleId: mod.id,
    enabled: mod.defaultEnabled,
    config: (mod.id === "icebreaker" ? { bank } : mod.config.defaults) as object,
  }));
}
