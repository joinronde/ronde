import { FEATURES } from "@ronde/editions";
import { messagesFor } from "@ronde/i18n";
import { MODULE_CATEGORIES, type ModuleDef, readConfig } from "@ronde/module-sdk";
import { describe, expect, it } from "vitest";
import { CATALOG, PAID_MODULES } from "../src/catalog";
import { MODULES as ALL } from "../src/index";

const MODULES = ALL as readonly ModuleDef[];

// Contract every module must keep: what the platform relies on to load, gate and show it

describe.each(MODULES.map((m) => [m.id, m] as const))("module %s", (id, mod) => {
  it("has a short lowercase id and a known category and feature", () => {
    expect(id).toMatch(/^[a-z][a-zA-Z]{1,29}$/);
    expect(MODULE_CATEGORIES).toContain(mod.category);
    expect(FEATURES[mod.feature]).toBeDefined();
  });

  it("prefixes its operations with its id", () => {
    for (const op of mod.ops) expect(op.name.startsWith(`${id}.`)).toBe(true);
  });

  it("has valid defaults, used when nothing or something invalid is saved", () => {
    expect(mod.config.schema.safeParse(mod.config.defaults).success).toBe(true);
    expect(readConfig(mod, undefined)).toEqual(mod.config.defaults);
  });

  it("is named and described in every language", () => {
    for (const locale of ["en", "fr"] as const) {
      const item = (messagesFor(locale).modules.items as Record<string, { name: string; description: string }>)[id];
      expect(item?.name).toBeTruthy();
      expect(item?.description).toBeTruthy();
    }
  });
});

describe("module registry", () => {
  it("has unique ids and unique operation names", () => {
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(MODULES.length);
    const ops = MODULES.flatMap((m) => m.ops.map((o) => o.name));
    expect(new Set(ops).size).toBe(ops.length);
  });

  it("matches the browser catalog", () => {
    expect(CATALOG).toEqual(
      MODULES.map(({ id, category, feature, defaultEnabled, icon }) => ({ id, category, feature, defaultEnabled, icon })),
    );
  });

  it("only announces paid modules that a paid edition includes", () => {
    for (const p of PAID_MODULES) {
      expect(FEATURES[p.feature].edition).not.toBe("community");
      expect((messagesFor("en").modules.items as Record<string, unknown>)[p.id]).toBeDefined();
    }
  });
});
