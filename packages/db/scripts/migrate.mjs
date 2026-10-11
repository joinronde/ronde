// Prisma migrations (prisma/migrations), run by the "migrate" service (a one-off container or job) before
// the app serves the new version. DATABASE_URL can come from a secret file.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL && process.env.DATABASE_URL_FILE) {
  process.env.DATABASE_URL = readFileSync(process.env.DATABASE_URL_FILE, "utf8").trim();
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL or DATABASE_URL_FILE must be set");
  process.exit(1);
}

// Staging only (RESET_WHEN_MIGRATIONS_CHANGE=1): while Ronde keeps a single initial migration, rewritten when
// the schema changes, a database that applied an older copy of it would never get the new schema. When a
// migration it applied differs from the file now (Prisma keeps the sha256 of each one), the database is emptied
// and migrated from scratch. Never set it where the data matters.
if (process.env.RESET_WHEN_MIGRATIONS_CHANGE === "1") {
  const { default: pg } = await import("pg");
  // The schema Prisma uses: ?schema=… in the address, "public" otherwise
  const schema = new URL(process.env.DATABASE_URL).searchParams.get("schema") || "public";
  const quoted = `"${schema.replace(/"/g, '""')}"`;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const applied = await client
    .query(`SELECT migration_name, checksum FROM ${quoted}."_prisma_migrations" WHERE finished_at IS NOT NULL`)
    .then((r) => r.rows)
    .catch(() => []);
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../prisma/migrations");
  const changed = applied.filter(({ migration_name: name, checksum }) => {
    const file = path.join(dir, name, "migration.sql");
    return !existsSync(file) || createHash("sha256").update(readFileSync(file)).digest("hex") !== checksum;
  });
  if (changed.length) {
    console.log(`Migrations changed since they were applied (${changed.map((m) => m.migration_name).join(", ")}): emptying the database.`);
    await client.query(`DROP SCHEMA ${quoted} CASCADE; CREATE SCHEMA ${quoted};`);
  }
  await client.end();
}

const prisma = createRequire(import.meta.url).resolve("prisma/build/index.js");
console.log("Applying migrations…");
try {
  execFileSync(process.execPath, [prisma, "migrate", "deploy"], { stdio: "inherit" });
} catch {
  console.error("Prisma migrations failed.");
  process.exit(1);
}
