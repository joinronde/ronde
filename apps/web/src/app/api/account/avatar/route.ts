import { NextResponse } from "next/server";
import { setAccountPhoto } from "@/lib/server/account-photo";
import { requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";

// The photo of the signed-in person, set from their account for every workspace they belong to
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    return NextResponse.json({ ok: true, cards: await setAccountPhoto(user.id, new Uint8Array(await req.arrayBuffer())) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    return NextResponse.json({ ok: true, cards: await setAccountPhoto(user.id, null) });
  } catch (e) {
    return errorResponse(e);
  }
}
