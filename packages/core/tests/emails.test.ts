import { describe, expect, it } from "vitest";
import { type AuthEmailKind, authEmail } from "../src/emails";

const KINDS: AuthEmailKind[] = ["verify", "magicLink", "resetPassword", "invitation"];
const url = "https://app.example.com/invite/abc?x=1&y=2";

describe("authEmail", () => {
  it("renders every kind in English and French, with the link in both parts", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const kind of KINDS) {
        const mail = authEmail(kind, { url, locale, workspace: "Product team", inviter: "Ada" });
        expect(mail.subject.length).toBeGreaterThan(0);
        expect(mail.text).toContain(url);
        expect(mail.html).toContain(`lang="${locale}"`);
        expect(mail.html).toContain("https://app.example.com/invite/abc?x=1&amp;y=2");
      }
    }
  });

  it("names the workspace and the inviter in an invitation", () => {
    const mail = authEmail("invitation", { url, locale: "en", workspace: "Product team", inviter: "Ada" });
    expect(`${mail.subject} ${mail.text}`).toContain("Product team");
    expect(mail.text).toContain("Ada");
  });

  it("escapes names in the HTML part", () => {
    const mail = authEmail("invitation", { url, locale: "en", workspace: "<script>x</script>", inviter: "Ada" });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
