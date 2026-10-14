// SPDX-License-Identifier: LicenseRef-Ronde-EE
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { escapeFilter, ldapAuthenticate, ldapTest } from "../src/identity/ldap";
import { startDirectory } from "./ldap-server";

let dir: Awaited<ReturnType<typeof startDirectory>>;
const settings = () => ({
  url: dir.url,
  startTls: false,
  bindDn: dir.service.dn,
  bindPassword: dir.service.password,
  baseDn: "ou=people,dc=acme,dc=test",
  userFilter: "(&(objectClass=person)(mail={{email}}))",
  emailAttribute: "mail",
  nameAttribute: "cn",
});

beforeAll(async () => {
  dir = await startDirectory([
    {
      dn: "uid=ada,ou=people,dc=acme,dc=test",
      password: "ada-secret",
      attributes: {
        mail: "ada@acme.test",
        cn: "Ada Lovelace",
        uid: "ada",
        // Stored in lower case, as directories match attribute names whatever their case
        telephonenumber: "+44 20 7946 0000",
        department: "Engines",
        birthdate: "18151210",
      },
    },
    { dn: "uid=twin1,ou=people,dc=acme,dc=test", password: "x", attributes: { mail: "twin@acme.test", cn: "Twin One" } },
    { dn: "uid=twin2,ou=people,dc=acme,dc=test", password: "x", attributes: { mail: "twin@acme.test", cn: "Twin Two" } },
  ]);
});

afterAll(() => dir.close());

describe("escapeFilter", () => {
  it("neutralises the characters that would change a search", () => {
    expect(escapeFilter("*)(uid=*")).toBe("\\2a\\29\\28uid=\\2a");
    expect(escapeFilter("a\\b")).toBe("a\\5cb");
  });
});

describe("ldapAuthenticate", () => {
  it("signs in a person with their directory password", async () => {
    expect(await ldapAuthenticate(settings(), "ADA@acme.test", "ada-secret")).toEqual({
      email: "ada@acme.test",
      name: "Ada Lovelace",
      profile: {},
    });
  });

  it("brings the phone, the team and the birthday from the attributes set", async () => {
    const s = { ...settings(), phoneAttribute: "telephoneNumber", teamAttribute: "department", birthdayAttribute: "birthDate" };
    expect((await ldapAuthenticate(s, "ada@acme.test", "ada-secret"))?.profile).toEqual({
      phone: "+44 20 7946 0000",
      team: "Engines",
      birthday: "12-10",
    });
    // An attribute left empty is not read
    expect((await ldapAuthenticate({ ...s, birthdayAttribute: "" }, "ada@acme.test", "ada-secret"))?.profile).toEqual({
      phone: "+44 20 7946 0000",
      team: "Engines",
    });
  });

  it("refuses a wrong password, an empty one, an unknown address and an injected filter", async () => {
    expect(await ldapAuthenticate(settings(), "ada@acme.test", "wrong")).toBeNull();
    expect(await ldapAuthenticate(settings(), "ada@acme.test", "")).toBeNull();
    expect(await ldapAuthenticate(settings(), "nobody@acme.test", "ada-secret")).toBeNull();
    expect(await ldapAuthenticate(settings(), "*", "ada-secret")).toBeNull();
  });

  it("refuses an address the directory gives to two people", async () => {
    expect(await ldapAuthenticate(settings(), "twin@acme.test", "x")).toBeNull();
  });

  it("reports a wrong service account when testing the settings", async () => {
    expect(await ldapTest(settings(), "ada@acme.test")).toEqual({ ok: true, found: 1 });
    expect(await ldapTest({ ...settings(), bindPassword: "nope" }, "ada@acme.test")).toMatchObject({ ok: false });
  });
});
