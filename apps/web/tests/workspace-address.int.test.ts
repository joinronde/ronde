import { prisma } from "@ronde/db";
import { describe, expect, it } from "vitest";
import type { CurrentUser } from "@/lib/server/authz";
import { createWorkspace } from "@/lib/server/workspaces";

// A workspace's address: the reserved ones (which would pass for Ronde's own pages) are for the instance's
// administrators, and the person is told why, not that the address is badly written

const account = async (instanceRole: "user" | "admin"): Promise<CurrentUser> => {
  const id = crypto.randomUUID();
  return prisma.user.create({
    data: { id, email: `${id}@address.test`, name: "Ada Address", emailVerified: true, instanceRole },
    select: { id: true, name: true, email: true, image: true, locale: true, timezone: true, instanceRole: true },
  });
};

describe("workspace addresses", () => {
  it("keeps the reserved addresses for the instance's administrators, and says so", async () => {
    await expect(createWorkspace(await account("user"), { name: "Ronde", slug: "ronde" })).rejects.toMatchObject({
      key: "slugReserved",
      values: { slug: "ronde-2" },
    });
    await expect(createWorkspace(await account("user"), { name: "Bad", slug: "-bad-" })).rejects.toMatchObject({ key: "slugInvalid" });
    expect(await createWorkspace(await account("admin"), { name: "Ronde", slug: "ronde" })).toEqual({ slug: "ronde" });
  });
});
