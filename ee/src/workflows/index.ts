// Ronde Enterprise Edition. Copyright (c) Ronde. Licensed under the Ronde Enterprise License (see ee/LICENSE).
import type { EnterpriseEdition } from "@ronde/editions/ee";

// Workflows: a notification goes out only when its conditions hold, with the words the team wrote

const TEST: Record<string, (a: number, b: number) => boolean> = {
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  "=": (a, b) => a === b,
  "!=": (a, b) => a !== b,
};

export function matches(conditions: { field: string; op: string; value: number }[], facts: Record<string, number>): boolean {
  return conditions.every((c) => {
    const test = TEST[c.op];
    const fact = facts[c.field];
    // An unknown figure never lets a message through by mistake
    return !!test && typeof fact === "number" && test(fact, c.value);
  });
}

export function render(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, name: string) => (name in variables ? (variables[name] ?? "") : all)).trim();
}

export const workflows: EnterpriseEdition["workflows"] = { matches, render };
