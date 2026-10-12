import { prisma } from "@ronde/db";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { accountPhoto, setAccountPhoto } from "@/lib/server/account-photo";
import { workspace } from "./fixtures";

// A photo set from the account goes on the person's card in every workspace they belong to

/** A small real WebP image: photos are drawn again on arrival, a header alone is not one */
const webp = async () =>
  new Uint8Array(
    await sharp({ create: { width: 8, height: 8, channels: 3, background: "#3366cc" } })
      .webp()
      .toBuffer(),
  );

describe("the account's photo", () => {
  it("goes on every card of the person, and leaves them all when removed", async () => {
    const run = Date.now().toString(36);
    const a = await workspace(`photo-a-${run}`);
    const b = await prisma.workspace.create({ data: { slug: `photo-b-${run}`, name: "B" } });
    const card = await prisma.person.create({ data: { workspaceId: b.id, userId: a.user.id, email: a.user.email, firstName: "Host" } });
    await prisma.workspaceMember.create({ data: { workspaceId: b.id, userId: a.user.id, personId: card.id } });

    expect(await accountPhoto(a.user.id)).toMatchObject({ url: null });
    expect(await setAccountPhoto(a.user.id, await webp())).toBe(2);
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
    expect(await setAccountPhoto(user.id, await webp())).toBe(0);
  });
});
