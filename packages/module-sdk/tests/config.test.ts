import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineModule, readConfig } from "../src/modules";

const mod = defineModule({
  id: "demo",
  category: "facilitation",
  feature: "modules.facilitation",
  defaultEnabled: true,
  icon: "✨",
  config: { schema: z.object({ size: z.number().int().min(1), label: z.string() }), defaults: { size: 3, label: "x" } },
  ops: [],
});

describe("readConfig", () => {
  it("completes a saved configuration with the defaults", () => {
    expect(readConfig(mod, { size: 5 })).toEqual({ size: 5, label: "x" });
    expect(readConfig(mod, null)).toEqual({ size: 3, label: "x" });
  });
  it("falls back to the defaults when the saved one is invalid", () => {
    expect(readConfig(mod, { size: -1 })).toEqual({ size: 3, label: "x" });
  });
});
