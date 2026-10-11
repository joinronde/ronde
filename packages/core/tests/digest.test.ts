import { digestEmail } from "@ronde/core/notifications";
import { describe, expect, it } from "vitest";

// Digest of an async session: the minutes by email, in the meeting's language, nothing injected

const input = {
  teamName: "Product <team>",
  locale: "en" as const,
  date: "2026-10-12",
  name: "Ana Lima",
  minutes: "# Minutes\n\n## Decisions\n- ship <b>SSO</b>",
  url: "https://ronde.example.com/w/acme/m/1/me",
};

describe("digestEmail", () => {
  it("greets the person and carries the minutes and the link", () => {
    const mail = digestEmail(input);
    expect(mail.subject).toBe("Product <team> · the digest of Monday, October 12");
    expect(mail.text).toContain("Hello Ana,");
    expect(mail.text).toContain("## Decisions\n- ship <b>SSO</b>");
    expect(mail.text).toContain("Open the meeting in Ronde: https://ronde.example.com/w/acme/m/1/me");
    expect(mail.html).toContain("Product &lt;team&gt;");
    expect(mail.html).not.toContain("<b>SSO</b>");
  });

  it("is written in French, and leaves out an unsafe link", () => {
    const mail = digestEmail({ ...input, locale: "fr", url: "javascript:alert(1)" });
    expect(mail.subject).toBe("Product <team> · le récapitulatif du lundi 12 octobre");
    expect(mail.text).toContain("Bonjour Ana,");
    expect(mail.html).not.toContain("javascript:");
  });
});
