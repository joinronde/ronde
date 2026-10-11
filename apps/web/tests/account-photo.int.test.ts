import { prisma } from "@ronde/db";
import { describe, expect, it } from "vitest";
import { accountPhoto, setAccountPhoto } from "@/lib/server/account-photo";
import { workspace } from "./fixtures";

// A photo set from the account goes on the person's card in every workspace they belong to

/** The first bytes of a WebP file, enough for the type check */
const webp = () => new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 "), 1, 2, 3]);

describe("the account's photo", () => {
  it("goes on every card of the person, and leaves them all when removed", async () => {
    const run = Date.now().toString(36);
    const a = await workspace(`photo-a-${run}`);
    const b = await prisma.workspace.create({ data: { slug: `photo-b-${run}`, name: "B" } });
    const card = await prisma.person.create({ data: { workspaceId: b.id, userId: a.user.id, email: a.user.email, firstName: "Host" } });
    await prisma.workspaceMember.create({ data: { workspaceId: b.id, userId: a.user.id, personId: card.id } });

    expect(await accountPhoto(a.user.id)).toMatchObject({ url: null });
    expect(await setAccountPhoto(a.user.id, webp())).toBe(2);
    const photos = await prisma.personAvatar.findMany({ where: { personId: { in: [a.host.id, card.id] } } });
    expect(photos.map((p) => p.type)).toEqual(["image/webp", "image/webp"]);
    expect((await accountPhoto(a.user.id))?.url).toMatch(new RegExp(`^/api/w/photo-a-${run}/avatar/${a.host.id}\\?v=\\d+$`));

    // Not an image: refused, nothing changed
    await expect(setAccountPhoto(a.user.id, new Uint8Array([60, 115, 118, 103]))).rejects.toThrow();
    expect(await setAccountPhoto(a.user.id, null)).toBe(2);
    expect(await prisma.personAvatar.count({ where: { personId: { in: [a.host.id, card.id] } } })).toBe(0);
  });

  it("has nowhere to go before the person joins a workspace", async () => {
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `alone-${Date.now()}@photo.test`, name: "Alone" } });
    expect(await accountPhoto(user.id)).toBeNull();
    expect(await setAccountPhoto(user.id, webp())).toBe(0);
  });
});
