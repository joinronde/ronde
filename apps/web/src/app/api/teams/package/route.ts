import { requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { teamsPackage } from "@/lib/server/teams";

// The app package an administrator uploads to Teams (manifest, translations, icons), built for this instance
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser();
    return new Response(Buffer.from(teamsPackage()), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="ronde-teams.zip"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
