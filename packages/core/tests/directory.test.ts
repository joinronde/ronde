import { describe, expect, it } from "vitest";
import { birthdayOf, directoryProfile, phoneOf } from "../src/directory";

// A company directory (LDAP, SCIM) used to bring only the name and the address: the phone, the team and the
// birthday now come too, read the way directories write them

describe("a directory's profile", () => {
  it("reads a birthday in the usual forms, keeping the day only", () => {
    expect(birthdayOf("1990-04-21")).toBe("04-21");
    expect(birthdayOf("19900421")).toBe("04-21");
    expect(birthdayOf("--04-21")).toBe("04-21");
    expect(birthdayOf("04-21")).toBe("04-21");
    expect(birthdayOf("21/04/1990")).toBe("04-21");
    expect(birthdayOf("1990-04-21T00:00:00Z")).toBe("04-21");
    expect(birthdayOf("1990-02-30")).toBeUndefined();
    expect(birthdayOf("next tuesday")).toBeUndefined();
    expect(birthdayOf("")).toBeUndefined();
  });

  it("keeps a phone number that reads as one", () => {
    expect(phoneOf(" +33 6  12 34 56 78 ")).toBe("+33 6 12 34 56 78");
    expect(phoneOf("(555) 010-2030")).toBe("(555) 010-2030");
    expect(phoneOf("call me")).toBeUndefined();
    expect(phoneOf(undefined)).toBeUndefined();
  });

  it("brings only what reads well", () => {
    expect(directoryProfile({ phone: "+44 20 7946 0000", team: " Platform ", birthday: "1988-12-01" })).toEqual({
      phone: "+44 20 7946 0000",
      team: "Platform",
      birthday: "12-01",
    });
    expect(directoryProfile({ phone: "n/a", team: "", birthday: "?" })).toEqual({});
  });
});
