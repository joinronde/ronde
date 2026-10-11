import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { formatters, negotiateLocale, resolveLocale } from "../src";
import { messages } from "../src/messages";

type Tree = { [key: string]: string | Tree };
const flatten = (tree: Tree, prefix = ""): Record<string, string> =>
  Object.entries(tree).reduce<Record<string, string>>((out, [k, v]) => {
    if (typeof v === "string") out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
    return out;
  }, {});

/** Argument names used by an ICU message ("{count, plural, …}" → count) */
function argumentsOf(message: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: ReturnType<typeof parse>) => {
    for (const node of nodes) {
      if (node.type !== TYPE.literal && node.type !== TYPE.pound && "value" in node) names.add(String(node.value));
      if ("options" in node) for (const option of Object.values(node.options)) walk(option.value);
      if (node.type === TYPE.tag) walk(node.children);
    }
  };
  walk(parse(message));
  return [...names].sort();
}

const en = flatten(messages.en as unknown as Tree);

/** Keys of every level: next-intl reads a dot as nesting, so a key holding one can never be found */
const keysOf = (tree: Tree): string[] => Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [k] : [k, ...keysOf(v)]));

describe("message catalogs", () => {
  for (const [locale, tree] of Object.entries(messages)) {
    const flat = flatten(tree as unknown as Tree);
    it(`${locale}: no key holds a dot`, () => {
      expect(keysOf(tree as unknown as Tree).filter((k) => k.includes("."))).toEqual([]);
    });
    it(`${locale}: same keys as English`, () => {
      expect(Object.keys(flat).sort()).toEqual(Object.keys(en).sort());
    });
    it(`${locale}: every message is valid ICU, with the same arguments as English, and is not empty`, () => {
      for (const [key, message] of Object.entries(flat)) {
        expect(message.trim(), key).not.toBe("");
        expect(argumentsOf(message), key).toEqual(argumentsOf(en[key]!));
      }
    });
  }
});

describe("locale negotiation", () => {
  it("picks the best supported language", () => {
    expect(negotiateLocale("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(negotiateLocale("nl-NL,nl;q=0.9,en;q=0.5")).toBe("en");
    expect(negotiateLocale("nl-NL")).toBe("en");
    expect(negotiateLocale("zh-CN,zh;q=0.9")).toBe("zh");
    expect(negotiateLocale("pt-BR")).toBe("pt");
    expect(negotiateLocale(null)).toBe("en");
  });
  it("resolves the first supported preference", () => {
    expect(resolveLocale(undefined, "xx", "fr", "en")).toBe("fr");
    expect(resolveLocale()).toBe("en");
  });
});

describe("formatters", () => {
  it("format dates, lists and numbers per locale", () => {
    expect(formatters("en").date("2026-10-05")).toBe("Monday, October 5, 2026");
    expect(formatters("fr").date("2026-10-05")).toBe("lundi 5 octobre 2026");
    expect(formatters("en").list(["Ana", "Bo", "Cy"])).toBe("Ana, Bo, and Cy");
    expect(formatters("fr").list(["Ana", "Bo", "Cy"])).toBe("Ana, Bo et Cy");
    expect(formatters("fr").decimal(4.25)).toBe("4,3");
    expect(formatters("en").weekday(1)).toBe("Monday");
    expect(formatters("fr").month(2)).toBe("février");
  });
});
