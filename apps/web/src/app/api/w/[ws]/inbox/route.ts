import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { listInbox, markRead } from "@/lib/server/inbox";

export const dynamic = "force-dynamic";

// The bell of the top bar: the person's recent notifications, and marking them read

export async function GET(_req: Request, { params }: { params: Promise<{ ws: string }> }) {
  try {
    const ctx = await authorize((await params).ws);
    return NextResponse.json(await listInbox(ctx));
  } catch (e) {
    return errorResponse(e);
  }
}

const body = z.object({ id: z.string().max(50).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  try {
    const ctx = await authorize((await params).ws);
    const { id } = body.parse(await req.json().catch(() => ({})));
    await markRead(ctx, id);
    return NextResponse.json(await listInbox(ctx));
  } catch (e) {
    return errorResponse(e);
  }
}
