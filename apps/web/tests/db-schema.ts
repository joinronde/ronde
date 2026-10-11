import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { config } from "dotenv";
import { afterAll } from "vitest";

// Each integration test file migrates its own PostgreSQL schema, then drops it: the dev database is untouched
config({ path: path.resolve(import.meta.dirname, "../.env"), quiet: true });
const schema = `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const baseUrl = process.env.DATABASE_URL!;
process.env.DATABASE_SCHEMA = schema;

const dbPackage = path.dirname(createRequire(import.meta.url).resolve("@ronde/db/package.json"));
const prismaCli = createRequire(path.join(dbPackage, "package.json")).resolve("prisma/build/index.js");
execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  cwd: dbPackage,
  env: {
    ...process.env,
    DATABASE_URL: `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}schema=${schema}`,
    // Each file migrates its own schema: the database-wide migration lock would only make the files wait
    // for each other, past its 10 s timeout when they all start together
    PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1",
  },
  stdio: "pipe",
});

afterAll(async () => {
  const { prisma } = await import("@ronde/db");
  // Files dropping or migrating their schemas at the same moment may deadlock on the catalog: try again
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      break;
    } catch (e) {
      if (attempt >= 5 || !String(e).includes("40P01")) throw e;
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
  await prisma.$disconnect();
});
