import { NextResponse } from "next/server";
import { authorize } from "@/lib/server/authz";
import { OpError } from "@/lib/server/errors";
import { errorResponse } from "@/lib/server/http";
import { LOGO_MAX_BYTES, setProjectLogo } from "@/lib/server/project-logo";
import { readableMeetings, visibleWhere } from "@/lib/server/projects";

// Logo of a project: readable by the people who see the project, and by those of the meetings that follow it
// (their screen shows it on its step); uploaded and removed by those who edit it
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ ws: string; id: string }> };

/** The body sent, read no further than the limit (whatever length it announces, or none) */
async function readCapped(req: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const r = reader ? await reader.read() : { done: true as const, value: undefined };
    if (r.done) break;
    size += r.value.byteLength;
    if (size > max) {
      await reader?.cancel();
      throw new OpError("logoTooLarge", { max: max / 1000 });
    }
    chunks.push(r.value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { ws, id } = await params;
    const ctx = await authorize(ws);
    const project = await ctx.db.project.findFirst({ where: { id }, select: { logo: true } });
    if (!project?.logo) return new NextResponse(null, { status: 404 });
    const seen =
      (ctx.can("projects.read") && (await ctx.db.project.count({ where: { AND: [visibleWhere(ctx), { id }] } })) > 0) ||
      (await (async () => {
        const meetings = await readableMeetings(ctx);
        const followed = await ctx.db.meetingProject.findMany({ where: { projectId: id }, select: { meetingId: true } });
        return followed.some((f) => !meetings || meetings.has(f.meetingId));
      })());
    if (!seen) return new NextResponse(null, { status: 404 });
    // The URL carries the version (?v=…): the image can stay cached
    return new NextResponse(Buffer.from(project.logo.data), {
      headers: {
        "Content-Type": project.logo.type,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { ws, id } = await params;
    const ctx = await authorize(ws, "projects.read");
    await setProjectLogo(ctx, id, await readCapped(req, LOGO_MAX_BYTES));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { ws, id } = await params;
    await setProjectLogo(await authorize(ws, "projects.read"), id, null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
