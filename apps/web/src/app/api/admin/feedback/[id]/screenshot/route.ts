import { prisma } from "@ronde/db";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { isCloud } from "@/lib/server/license";

// The screenshot of a feedback, for the instance's administrators (the cloud's are in its back-office)
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (user.instanceRole !== "admin" || isCloud()) return new NextResponse(null, { status: 404 });
    const { id } = await params;
    const image = await prisma.feedbackImage.findUnique({ where: { feedbackId: id }, select: { data: true, type: true } });
    if (!image) return new NextResponse(null, { status: 404 });
    return new NextResponse(Buffer.from(image.data), {
      headers: {
        "Content-Type": image.type,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
