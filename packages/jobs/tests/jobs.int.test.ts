import path from "node:path";
import { config } from "dotenv";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { defineJob, startJobs } from "../src/index";

config({ path: path.resolve(import.meta.dirname, "../../../apps/web/.env"), quiet: true });
const schema = `jobs_test_${Date.now().toString(36)}`;
const connectionString = process.env.DATABASE_URL!;

afterAll(async () => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});

describe("jobs", () => {
  it("runs a queued job once, and reuses the runner of the process", async () => {
    const seen: string[] = [];
    const job = defineJob<{ who: string }>({
      name: "test.hello",
      handler: async ({ who }) => {
        seen.push(who);
      },
    });
    const runner = await startJobs({ connectionString, schema, jobs: [job], log: () => undefined });
    expect(await startJobs({ connectionString, schema, jobs: [job] })).toBe(runner);
    await runner.send("test.hello", { who: "ada" }, { singletonKey: "ada" });
    // Same key while the first one is queued: not queued twice
    await runner.send("test.hello", { who: "ada" }, { singletonKey: "ada" });
    for (let i = 0; i < 40 && !seen.length; i++) await new Promise((r) => setTimeout(r, 250));
    await runner.stop();
    expect(seen).toEqual(["ada"]);
  });
});
