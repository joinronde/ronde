import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GLOBAL_MODELS, TENANT_MODELS } from "../src/tenancy";

/** Models declared in the Prisma schema, with whether they have a workspaceId column */
function schemaModels() {
  const dir = path.resolve(import.meta.dirname, "../prisma/schema");
  const models = new Map<string, boolean>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".prisma"))) {
    const text = readFileSync(path.join(dir, file), "utf8");
    for (const match of text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) models.set(match[1]!, /^\s+workspaceId\s/m.test(match[2]!));
  }
  return models;
}

describe("tenancy", () => {
  const models = schemaModels();

  it("lists every model with a workspaceId as a tenant model", () => {
    const withWorkspace = [...models].filter(([, has]) => has).map(([name]) => name);
    expect([...TENANT_MODELS].sort()).toEqual(withWorkspace.sort());
  });

  it("classifies every model, either tenant or global", () => {
    const known = new Set<string>([...TENANT_MODELS, ...GLOBAL_MODELS]);
    expect([...models.keys()].filter((m) => !known.has(m))).toEqual([]);
    expect(GLOBAL_MODELS.filter((m) => !models.has(m))).toEqual([]);
  });
});
