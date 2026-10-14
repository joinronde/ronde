import { prisma } from "@ronde/db";
import { describe, expect, it } from "vitest";
import { applyProfile } from "@/lib/server/identity";
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
});
