import { NextResponse } from "next/server";
import { exportAccount } from "@/lib/server/account-data";
import { requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";

// Everything Ronde holds about the signed-in account, as a JSON file to keep or take elsewhere
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const data = await exportAccount(user.id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="ronde-account-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
