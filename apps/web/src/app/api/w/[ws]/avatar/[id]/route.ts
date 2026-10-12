import { NextResponse } from "next/server";
import { authorize, type WorkspaceContext } from "@/lib/server/authz";
import { publishWorkspace } from "@/lib/server/bus";
import { AccessError } from "@/lib/server/errors";
import { errorResponse } from "@/lib/server/http";
import { AVATAR_MAX_BYTES, receiveImage } from "@/lib/server/images";

// Photo of a person of the directory: readable by the workspace; uploaded and removed by the person
// themselves or by someone managing the directory
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ ws: string; id: string }> };

async function canEdit(slug: string, id: string): Promise<WorkspaceContext> {
  const ctx = await authorize(slug, "people.read");
  if (ctx.member.personId !== id && !ctx.can("people.manage")) throw new AccessError(403, "ownAvatarOnly");
  if (!(await ctx.db.person.findFirst({ where: { id }, select: { id: true } }))) throw new AccessError(403, "unknownMember");
  return ctx;
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { ws, id } = await params;
    const ctx = await authorize(ws, "people.read");
    const a = await ctx.db.personAvatar.findFirst({ where: { personId: id } });
    if (!a) return new NextResponse(null, { status: 404 });
    // The URL carries the version (?v=…): the image can stay cached
    return new NextResponse(Buffer.from(a.data), {
      headers: { "Content-Type": a.type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { ws, id } = await params;
    const ctx = await canEdit(ws, id);
    const { data, type } = await receiveImage(req, {
      maxBytes: AVATAR_MAX_BYTES,
      side: 512,
      tooLarge: "avatarTooLarge",
      format: "avatarFormat",
    });
    await ctx.db.personAvatar.upsert({
      where: { personId: id },
      create: { personId: id, workspaceId: ctx.workspace.id, data, type },
      update: { data, type },
    });
    // Shown in every meeting of the person
    await publishWorkspace(ctx.workspace.id, [id]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { ws, id } = await params;
    const ctx = await canEdit(ws, id);
    await ctx.db.personAvatar.deleteMany({ where: { personId: id } });
    await publishWorkspace(ctx.workspace.id, [id]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
