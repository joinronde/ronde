import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

// A single instance per process, created on first use: "next build" therefore does not need DATABASE_URL.
const g = globalThis as unknown as { __rondePrisma?: PrismaClient };

function client(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing environment variable: DATABASE_URL");
  // DATABASE_SCHEMA: another PostgreSQL schema than "public" (integration tests use a throwaway one)
  const schema = process.env.DATABASE_SCHEMA;
  // Raw SQL is not qualified by Prisma: the connection's search_path points at the same schema
  const pool = schema ? { connectionString: url, options: `-c search_path="${schema}"` } : { connectionString: url };
  g.__rondePrisma ??= new PrismaClient({ adapter: new PrismaPg(pool, schema ? { schema } : undefined) });
  return g.__rondePrisma;
}

/**
 * Unscoped client: sees every workspace. Only for system code (authentication, background jobs, webhooks,
 * instance administration). Request handlers use `scoped(workspaceId)`.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop, c) as unknown;
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(c) : value;
  },
});
