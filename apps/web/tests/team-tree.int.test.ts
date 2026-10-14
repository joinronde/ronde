import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { addJobCategory, deleteJobCategory, moveJobCategory, styleJobCategory } from "@/lib/server/workspaces";
import { type Fixture, meeting, workspace } from "./fixtures";

// Teams inside teams in the directory: no loop, no tree deeper than four levels, a deleted team's sub-teams move up
// to where it was, and a team's drawing is one of the app's

let f: Fixture;
const idOf = async (name: string) => (await prisma.jobCategory.findFirstOrThrow({ where: { workspaceId: f.workspaceId, name } })).id;

beforeAll(async () => {
  f = await meeting(await workspace("teams-tree"), "Weekly");
});

describe("team tree", () => {
  it("creates a team under another one", async () => {
    await addJobCategory(f.ctx.ws, "Product");
    await addJobCategory(f.ctx.ws, "Design", await idOf("Product"));
    expect((await prisma.jobCategory.findFirstOrThrow({ where: { workspaceId: f.workspaceId, name: "Design" } })).parentId).toBe(
      await idOf("Product"),
    );
  });

  it("refuses to put a team under one of its own sub-teams", async () => {
    await expect(moveJobCategory(f.ctx.ws, await idOf("Product"), await idOf("Design"))).rejects.toMatchObject({ key: "teamLoop" });
    await expect(moveJobCategory(f.ctx.ws, await idOf("Product"), await idOf("Product"))).rejects.toMatchObject({ key: "teamLoop" });
  });

  it("keeps the tree four levels deep at most", async () => {
    await addJobCategory(f.ctx.ws, "UX", await idOf("Design"));
    await addJobCategory(f.ctx.ws, "Research", await idOf("UX"));
    await expect(addJobCategory(f.ctx.ws, "Too deep", await idOf("Research"))).rejects.toMatchObject({ key: "teamTooDeep" });
    // A whole branch moved under another team counts its own depth too
    await addJobCategory(f.ctx.ws, "Ops");
    await expect(moveJobCategory(f.ctx.ws, await idOf("Product"), await idOf("Ops"))).rejects.toMatchObject({ key: "teamTooDeep" });
  });

  it("refuses a parent from another workspace", async () => {
    const other = await meeting(await workspace("teams-other"), "Other");
    await addJobCategory(other.ctx.ws, "Elsewhere");
    const elsewhere = (await prisma.jobCategory.findFirstOrThrow({ where: { workspaceId: other.workspaceId } })).id;
    await expect(moveJobCategory(f.ctx.ws, await idOf("Ops"), elsewhere)).rejects.toMatchObject({ key: "invalidRequest" });
  });

  it("moves a deleted team's sub-teams up to where it was, and keeps its people", async () => {
    const person = await prisma.person.findFirstOrThrow({ where: { workspaceId: f.workspaceId } });
    await prisma.person.update({ where: { id: person.id }, data: { jobCategoryId: await idOf("UX") } });
    await deleteJobCategory(f.ctx.ws, await idOf("UX"));
    expect((await prisma.jobCategory.findFirstOrThrow({ where: { workspaceId: f.workspaceId, name: "Research" } })).parentId).toBe(
      await idOf("Design"),
    );
    expect((await prisma.person.findUniqueOrThrow({ where: { id: person.id } })).jobCategoryId).toBeNull();
  });

  it("takes a drawing and a colour of the app's sets only", async () => {
    const id = await idOf("Design");
    await styleJobCategory(f.ctx.ws, id, { icon: "palette", color: 3 });
    expect(await prisma.jobCategory.findUniqueOrThrow({ where: { id } })).toMatchObject({ icon: "palette", color: 3 });
    await expect(styleJobCategory(f.ctx.ws, id, { icon: "<script>" })).rejects.toMatchObject({ key: "invalidRequest" });
    await expect(styleJobCategory(f.ctx.ws, id, { color: 9 })).rejects.toMatchObject({ key: "invalidRequest" });
  });
});
