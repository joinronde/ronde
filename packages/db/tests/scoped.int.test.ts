import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client";
import { scoped, TenantViolation } from "../src/scoped";

config({ path: [path.resolve(import.meta.dirname, "../.env"), path.resolve(import.meta.dirname, "../../../apps/web/.env")], quiet: true });

// Each run migrates its own schema, then drops it: the dev database is left untouched
const schema = `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const baseUrl = process.env.DATABASE_URL!;
const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}schema=${schema}`;
let db: PrismaClient;
let a: string;
let b: string;

beforeAll(() => {
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: baseUrl }, { schema }) });
});

afterAll(async () => {
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.$disconnect();
});

describe("tenant-scoped client", () => {
  beforeAll(async () => {
    a = (await db.workspace.create({ data: { slug: "acme", name: "Acme" } })).id;
    b = (await db.workspace.create({ data: { slug: "globex", name: "Globex" } })).id;
    await db.person.create({ data: { workspaceId: a, email: "ana@acme.test", firstName: "Ana" } });
    await db.person.create({ data: { workspaceId: b, email: "bob@globex.test", firstName: "Bob" } });
  });

  it("only reads rows of its own workspace", async () => {
    const people = await scoped(db, a).person.findMany();
    expect(people.map((p) => p.firstName)).toEqual(["Ana"]);
    expect(await scoped(db, a).person.count()).toBe(1);
  });

  it("treats another workspace's row as missing, by id too", async () => {
    const bob = await db.person.findFirstOrThrow({ where: { workspaceId: b } });
    expect(await scoped(db, a).person.findUnique({ where: { id: bob.id } })).toBeNull();
    await expect(scoped(db, a).person.update({ where: { id: bob.id }, data: { firstName: "Hacked" } })).rejects.toThrow();
    expect(await scoped(db, a).person.deleteMany({ where: { id: bob.id } })).toEqual({ count: 0 });
    expect((await db.person.findUniqueOrThrow({ where: { id: bob.id } })).firstName).toBe("Bob");
  });

  it("sets the workspace on creates and refuses another one", async () => {
    const created = await scoped(db, a).person.create({ data: { email: "cy@acme.test", firstName: "Cy" } as never });
    expect(created.workspaceId).toBe(a);
    await expect(scoped(db, a).person.create({ data: { workspaceId: b, email: "x@globex.test", firstName: "X" } })).rejects.toThrow(
      TenantViolation,
    );
    await expect(scoped(db, a).person.update({ where: { id: created.id }, data: { workspaceId: b } as never })).rejects.toThrow(
      TenantViolation,
    );
  });

  it("leaves global models alone", async () => {
    expect(await scoped(db, a).workspace.count()).toBe(2);
  });
});
