import { describe, expect, it } from "vitest";
import { EDITIONS, FEATURES, type FeatureId, featuresAddedBy, hasFeature, includes } from "../src/index";

describe("editions", () => {
  it("includes the features of every lower edition", () => {
    for (const feature of Object.keys(FEATURES) as FeatureId[]) {
      const from = EDITIONS.indexOf(FEATURES[feature].edition);
      EDITIONS.forEach((edition, i) => expect(includes(edition, feature)).toBe(i >= from));
    }
  });

  it("never enables a feature that is not shipped", () => {
    expect(hasFeature("enterprise", "compliance.retention")).toBe(false);
    expect(hasFeature("community", "identity.oidc")).toBe(true);
    expect(hasFeature("community", "modules.workflows")).toBe(false);
  });

  it("keeps the Community edition generous: identity, meetings and facilitation modules", () => {
    for (const f of ["identity.oidc", "identity.twoFactor", "meetings.unlimited", "modules.facilitation", "modules.notifications"] as const)
      expect(FEATURES[f].edition).toBe("community");
  });

  it("lists what each paid edition adds", () => {
    expect(featuresAddedBy("team")).toContain("reporting.workspace");
    expect(featuresAddedBy("enterprise")).toContain("identity.saml");
    expect(featuresAddedBy("team")).not.toContain("identity.saml");
  });
});

describe("feature names", () => {
  // Loading the catalogs of the ten languages takes a few seconds on a busy machine
  it("names every feature in every language, for the pricing page and the upgrade hints", { timeout: 60_000 }, async () => {
    const { locales, messagesFor } = await import("@ronde/i18n");
    for (const locale of locales) {
      const names = messagesFor(locale).features as Record<string, Record<string, string>>;
      for (const id of Object.keys(FEATURES)) {
        const [area, name] = id.split(".");
        expect(names[area!]?.[name!], `${locale} ${id}`).toBeTruthy();
      }
    }
  });
});
