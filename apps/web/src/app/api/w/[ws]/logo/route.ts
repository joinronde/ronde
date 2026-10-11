import { prisma } from "@ronde/db";
import { NextResponse } from "next/server";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/authz";
import { brandingOn } from "@/lib/server/branding";
import { publish } from "@/lib/server/bus";
import { AccessError, OpError } from "@/lib/server/errors";
import { errorResponse } from "@/lib/server/http";
import { sniffImage } from "@/lib/server/images";

// Logo of the workspace: public (emails and the shared screen load it), uploaded and removed by its admins
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ ws: string }> };

/** Already resized in the browser; a logo never needs more */
const MAX_BYTES = 300_000;

export async function GET(_req: Request, { params }: Ctx) {
  const { ws } = await params;
  const w = await prisma.workspace.findUnique({ where: { slug: ws }, select: { deletedAt: true, plan: true, logo: true } });
  if (!w?.logo || w.deletedAt || !brandingOn(w)) return new NextResponse(null, { status: 404 });
  // The URL carries the version (?v=…): the image can stay cached
  return new NextResponse(Buffer.from(w.logo.data), {
    headers: { "Content-Type": w.logo.type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}

async function manage(slug: string) {
  const ctx = await authorize(slug, "workspace.manage");
  if (!brandingOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
  return ctx;
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const ctx = await manage((await params).ws);
    const data = new Uint8Array(await req.arrayBuffer());
    if (!data.length || data.length > MAX_BYTES) throw new OpError("logoTooLarge", { max: MAX_BYTES / 1000 });
    const type = sniffImage(data);
    if (!type) throw new OpError("logoFormat");
    await ctx.db.workspaceLogo.upsert({
      where: { workspaceId: ctx.workspace.id },
      create: { workspaceId: ctx.workspace.id, data, type },
      update: { data, type },
    });
    await audit(ctx, ctx.db, { action: "workspace.logo", targetType: "workspace", targetId: ctx.workspace.id });
    await publish("*", { kind: "state" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const ctx = await manage((await params).ws);
    await ctx.db.workspaceLogo.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await audit(ctx, ctx.db, { action: "workspace.logoRemoved", targetType: "workspace", targetId: ctx.workspace.id });
    await publish("*", { kind: "state" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
