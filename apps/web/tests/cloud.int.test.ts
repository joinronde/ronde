import { afterEach, describe, expect, it } from "vitest";
import { editionOf, featureOn } from "@/lib/server/license";

// In the cloud, each workspace uses the features of its own plan; a self-hosted instance, its license

afterEach(() => {
  delete process.env.RONDE_CLOUD;
});

describe("editions in the cloud", () => {
  it("takes the plan of the workspace, Community when unknown", () => {
    process.env.RONDE_CLOUD = "1";
    expect(editionOf({ plan: "team" })).toBe("team");
    expect(editionOf({ plan: "nonsense" })).toBe("community");
    expect(editionOf(undefined)).toBe("community");
    expect(featureOn("modules.aiAssistant", { plan: "team" })).toBe(true);
    expect(featureOn("modules.aiAssistant", { plan: "community" })).toBe(false);
  });

  it("ignores the plan on a self-hosted instance: the license decides", () => {
    expect(editionOf({ plan: "team" })).toBe("community");
  });
});
