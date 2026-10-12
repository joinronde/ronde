import { LATEST_MIGRATION } from "@ronde/db/migrations";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";

// Health probe for Docker and orchestrators (no authentication). Healthy once the database answers and holds
// this version's newest migration: a new version waits for the migrate service, the previous one serving meanwhile
export const dynamic = "force-dynamic";

let migrated = false;

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ status: "database_unreachable" }, { status: 503 });
  }
  if (!migrated) {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "_prisma_migrations" WHERE migration_name = ${LATEST_MIGRATION} AND finished_at IS NOT NULL`.catch(
      () => [],
    );
    migrated = Number(rows[0]?.n ?? 0) > 0;
    if (!migrated) return NextResponse.json({ status: "migrations_pending", waiting: LATEST_MIGRATION }, { status: 503 });
  }
  return NextResponse.json({ status: "ok" });
}
