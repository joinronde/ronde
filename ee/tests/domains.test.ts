// SPDX-License-Identifier: LicenseRef-Ronde-EE
import { describe, expect, it } from "vitest";
import { cleanDomain } from "../src/domains";

describe("cleanDomain", () => {
  it("accepts what people paste, and refuses what is not a domain", () => {
    expect(cleanDomain(" Acme.COM ")).toBe("acme.com");
    expect(cleanDomain("@acme.com")).toBe("acme.com");
    expect(cleanDomain("https://mail.acme.co.uk/login")).toBe("mail.acme.co.uk");
    expect(cleanDomain("localhost")).toBeNull();
    expect(cleanDomain("acme")).toBeNull();
    expect(cleanDomain("ac me.com")).toBeNull();
    expect(cleanDomain("-acme.com")).toBeNull();
  });
});
