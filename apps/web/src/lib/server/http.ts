import "server-only";
import { translator } from "@ronde/i18n";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { requestLocale } from "./locale";

/** JSON error response the interface can show, in the viewer's language */
export async function errorResponse(e: unknown) {
  const t = translator(await requestLocale(), "errors");
  if (e instanceof AppError) return NextResponse.json({ error: t(e.key, e.values) }, { status: e.status });
  // A body that is not JSON, or not of the expected shape: the caller's mistake, not the server's
  if (e instanceof SyntaxError || e instanceof ZodError) {
    const details = e instanceof ZodError ? e.issues.map((i) => i.path.join(".") || i.message).join(", ") : "JSON";
    return NextResponse.json({ error: t("invalidRequest", { details }) }, { status: 400 });
  }
  console.error(e);
  return NextResponse.json({ error: t("unexpected") }, { status: 500 });
}
