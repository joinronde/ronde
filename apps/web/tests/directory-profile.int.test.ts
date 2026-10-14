import { prisma } from "@ronde/db";
import { describe, expect, it } from "vitest";
import { applyProfile } from "@/lib/server/directory-profile";
import { workspace } from "./fixtures";

// Signing in through the company directory used to bring only the name and the address: the phone and the team
// now follow it, and a birthday comes when the person has not entered one

describe("the company directory's profile", () => {
  it("copies the phone and the team (made if missing), and a birthday only when none was entered", async () => {
    const w = await workspace(`dir-profile-${Date.now().toString(36)}`);
    const card = () =>
      prisma.person.findUniqueOrThrow({
        where: { id: w.host.id },
        select: { phone: true, birthday: true, jobCategory: { select: { name: true } } },
      });
    await applyProfile(w.user.email.toUpperCase(), w.ws.id, { phone: "+33 1 23 45 67 89", team: "Platform", birthday: "04-21" });
    expect(await card()).toEqual({ phone: "+33 1 23 45 67 89", birthday: "04-21", jobCategory: { name: "Platform" } });
    // The directory moves them; the birthday they keep is theirs
    await prisma.person.update({ where: { id: w.host.id }, data: { birthday: "05-02" } });
    await applyProfile(w.user.email, w.ws.id, { team: "Data", birthday: "04-21" });
    expect(await card()).toEqual({ phone: "+33 1 23 45 67 89", birthday: "05-02", jobCategory: { name: "Data" } });
    // Nothing said: nothing changed
    await applyProfile(w.user.email, w.ws.id, {});
    expect((await card()).jobCategory).toEqual({ name: "Data" });
  });

  it("makes the directory's teams like teams made by hand: each last, each in the next colour", async () => {
    // All came at the top in the first colour, sharing it on the teams board
    const w = await workspace(`dir-teams-${Date.now().toString(36)}`);
    await applyProfile(w.user.email, w.ws.id, { team: "Sales" });
    await applyProfile(w.user.email, w.ws.id, { team: "Ops" });
    const teams = await prisma.jobCategory.findMany({ where: { workspaceId: w.ws.id }, orderBy: { position: "asc" } });
    const made = teams.filter((x) => ["Sales", "Ops"].includes(x.name));
    expect(made.map((x) => x.name)).toEqual(["Sales", "Ops"]);
    expect(new Set(made.map((x) => x.position)).size).toBe(2);
    expect(new Set(made.map((x) => x.color)).size).toBe(2);
    // Found again by its name, not made twice
    await applyProfile(w.user.email, w.ws.id, { team: "Sales" });
    expect(await prisma.jobCategory.count({ where: { workspaceId: w.ws.id, name: "Sales" } })).toBe(1);
  });
});
