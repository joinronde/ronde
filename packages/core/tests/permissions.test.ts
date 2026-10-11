import { describe, expect, it } from "vitest";
import { assignableRoles, CUSTOM_ROLE_PERMISSIONS, can, type Principal } from "../src/permissions";

const p = (workspaceRole: Principal["workspaceRole"], meetingRole: Principal["meetingRole"] = null): Principal => ({
  userId: "u",
  personId: "p",
  workspaceId: "w",
  workspaceRole,
  meetingRole,
});

describe("permissions", () => {
  it("gives owners everything and admins everything but billing and deletion", () => {
    expect(can(p("owner"), "workspace.billing")).toBe(true);
    expect(can(p("admin"), "workspace.billing")).toBe(false);
    expect(can(p("admin"), "workspace.delete")).toBe(false);
    expect(can(p("admin"), "people.invite")).toBe(true);
    // Admins act as hosts of every meeting
    expect(can(p("admin"), "session.run")).toBe(true);
  });

  it("lets members create meetings and read the directory, nothing more", () => {
    expect(can(p("member"), "meeting.create")).toBe(true);
    expect(can(p("member"), "people.read")).toBe(true);
    expect(can(p("member"), "people.invite")).toBe(false);
    expect(can(p("member"), "session.run")).toBe(false);
    expect(can(p("guest"), "people.read")).toBe(false);
  });

  it("follows the workspace policy for meeting creation", () => {
    expect(can(p("member"), "meeting.create", { meetingCreation: "admins" })).toBe(false);
    expect(can(p("admin"), "meeting.create", { meetingCreation: "admins" })).toBe(true);
    // Organizers create meetings whatever the policy, and invite the people they need
    expect(can(p("organizer"), "meeting.create", { meetingCreation: "admins" })).toBe(true);
    expect(can(p("organizer"), "people.invite")).toBe(true);
    expect(can(p("organizer"), "members.manage")).toBe(false);
  });

  it("keeps billing to the owner and the billing role", () => {
    expect(can(p("owner"), "workspace.billing")).toBe(true);
    expect(can(p("billing"), "workspace.billing")).toBe(true);
    expect(can(p("admin"), "workspace.billing")).toBe(false);
    // The billing role administers nothing else, nor creates meetings
    expect(can(p("billing"), "workspace.manage")).toBe(false);
    expect(can(p("billing"), "meeting.create")).toBe(false);
  });

  it("adds meeting roles on top of the workspace role", () => {
    expect(can(p("member", "host"), "meeting.configure")).toBe(true);
    expect(can(p("member", "cohost"), "session.run")).toBe(true);
    expect(can(p("member", "cohost"), "meeting.configure")).toBe(false);
    expect(can(p("member", "participant"), "session.participate")).toBe(true);
    expect(can(p("member", "participant"), "notes.read")).toBe(false);
    expect(can(p("guest", "observer"), "session.observe")).toBe(true);
    expect(can(p("guest", "observer"), "checkin.write.own")).toBe(false);
  });

  it("never lets someone hand out more than their own role", () => {
    expect(assignableRoles("owner")).toContain("owner");
    expect(assignableRoles("admin")).not.toContain("owner");
    expect(assignableRoles("member")).toEqual([]);
    expect(assignableRoles("organizer")).toEqual(["member", "guest"]);
    // Billing exists only where the workspace pays for a plan, and an administrator cannot hand it out
    expect(assignableRoles("owner")).not.toContain("billing");
    expect(assignableRoles("owner", { billing: true })).toContain("billing");
    expect(assignableRoles("admin", { billing: true })).not.toContain("billing");
  });
});

describe("custom roles", () => {
  const member = { userId: "u", personId: "p", workspaceId: "w", workspaceRole: "member" as const };

  it("add their permissions to the built-in role, on every meeting", () => {
    expect(can(member, "history.read")).toBe(false);
    expect(can({ ...member, extra: ["history.read", "stats.read"] }, "history.read")).toBe(true);
    expect(can({ ...member, extra: ["history.read"] }, "session.run")).toBe(false);
  });

  it("never grant owning the workspace", () => {
    expect(CUSTOM_ROLE_PERMISSIONS).not.toContain("workspace.billing");
    expect(CUSTOM_ROLE_PERMISSIONS).not.toContain("workspace.delete");
  });

  it("are labelled in every language", async () => {
    const { messagesFor } = await import("@ronde/i18n");
    for (const locale of ["en", "fr"] as const)
      for (const p of CUSTOM_ROLE_PERMISSIONS) {
        const label = p.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], messagesFor(locale).permissions);
        expect(typeof label, `${locale} ${p}`).toBe("string");
      }
  });
});
