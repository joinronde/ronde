import type { FeatureId } from "@ronde/editions";
import type { z } from "zod";
import type { OpDef } from "./ops";

export const MODULE_CATEGORIES = ["facilitation", "organisation", "formats", "integrations", "notifications", "reporting"] as const;
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

/** What the catalog shows about a module; safe to send to the browser */
export interface ModuleInfo {
  /** Short lowercase id, also the prefix of its operations: "kudos" → "kudos.add" */
  id: string;
  category: ModuleCategory;
  /** Edition feature that unlocks the module */
  feature: FeatureId;
  /** Turned on in new meetings */
  defaultEnabled: boolean;
  /** Emoji shown in the catalog */
  icon: string;
}

/**
 * Operations of a module (made with defineOp). Typed loosely on purpose: any element type here becomes the
 * contextual type of each defineOp() call and widens its literal name. The contract test checks them.
 */
type OpList = readonly unknown[];

export interface ModuleDef<C = unknown, O extends OpList = readonly OpDef[]> extends ModuleInfo {
  config: { schema: z.ZodType<C>; defaults: C };
  /** Operations, named "<module id>.<action>" */
  ops: O;
}

/** Declares a module; the operation names are kept literal, so the browser's operation type stays exact */
export const defineModule = <C, const O extends OpList>(def: ModuleDef<C, O>) => def;

/** Configuration of a module: what was saved, completed with the defaults; invalid values fall back to them */
export function readConfig<C>(mod: Pick<ModuleDef<C>, "config">, saved: unknown): C {
  const merged =
    saved && typeof saved === "object" && !Array.isArray(saved)
      ? { ...(mod.config.defaults as object), ...(saved as object) }
      : mod.config.defaults;
  const parsed = mod.config.schema.safeParse(merged);
  return parsed.success ? parsed.data : mod.config.defaults;
}
