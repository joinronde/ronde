import { readFileSync } from "node:fs";
import path from "node:path";

// The plan of a workspace, set as the cloud's billing or back-office would: straight in the database of the server
// under test (DATABASE_URL, or the app's .env)

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(import.meta.dirname, "../../.env"), "utf8");
  return /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim() ?? "";
}

export async function setPlan(slug: string, plan: "community" | "team" | "enterprise"): Promise<void> {
  process.env.DATABASE_URL = databaseUrl();
  const { prisma } = await import("@ronde/db");
  await prisma.workspace.update({ where: { slug }, data: { plan } });
}
