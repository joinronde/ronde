import { NextResponse } from "next/server";
import { setAccountPhoto } from "@/lib/server/account-photo";
import { requireUser } from "@/lib/server/authz";
import { AppError } from "@/lib/server/errors";
import { errorResponse, readCapped } from "@/lib/server/http";
import { AVATAR_MAX_BYTES } from "@/lib/server/images";

// The photo of the signed-in person, set from their account for every workspace they belong to
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const data = await readCapped(req, AVATAR_MAX_BYTES, () => new AppError("avatarTooLarge", { max: AVATAR_MAX_BYTES / 1000 }, 413));
    return NextResponse.json({ ok: true, cards: await setAccountPhoto(user.id, data) });
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
