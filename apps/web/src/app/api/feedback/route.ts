import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { AppError, OpError } from "@/lib/server/errors";
import { FEEDBACK_MAX_BYTES, feedbackInput, sendFeedback } from "@/lib/server/feedback";
import { errorResponse, readCapped } from "@/lib/server/http";
import { requestLocale } from "@/lib/server/locale";

// A message about Ronde from the person signed in: a form with "data" (JSON) and an optional "screenshot"
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const type = req.headers.get("content-type") ?? "";
    if (!type.startsWith("multipart/form-data")) throw new OpError("invalidRequest", { details: "multipart" });
    const body = await readCapped(req, FEEDBACK_MAX_BYTES, () => new AppError("feedbackTooLarge", {}, 413));
    const form = await new Response(body, { headers: { "content-type": type } }).formData();
    const data = form.get("data");
    const shot = form.get("screenshot");
    const input = feedbackInput.parse(JSON.parse(typeof data === "string" ? data : ""));
    const h = await headers();
    const { id } = await sendFeedback(user, input, shot instanceof Blob ? new Uint8Array(await shot.arrayBuffer()) : null, {
      browser: h.get("user-agent") ?? "",
      locale: await requestLocale(),
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return errorResponse(e);
  }
}
