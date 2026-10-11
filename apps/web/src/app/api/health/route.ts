import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";

// Health probe for Docker and orchestrators (no authentication)
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "database_unreachable" }, { status: 503 });
  }
}
