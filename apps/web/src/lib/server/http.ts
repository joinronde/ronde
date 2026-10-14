import "server-only";
import { translator } from "@ronde/i18n";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, InputError } from "./errors";
import { issuesText } from "./issues";
import { requestLocale } from "./locale";

/** JSON error response the interface can show, in the viewer's language */
export async function errorResponse(e: unknown) {
  const locale = await requestLocale();
  const t = translator(locale, "errors");
  if (e instanceof InputError)
    return NextResponse.json({ error: t("invalidRequest", { details: issuesText(e.issues, locale) }) }, { status: e.status });
  if (e instanceof AppError) return NextResponse.json({ error: t(e.key, e.values) }, { status: e.status });
  // A body that is not JSON, or not of the expected shape: the caller's mistake, not the server's
  if (e instanceof SyntaxError || e instanceof ZodError) {
    const details = e instanceof ZodError ? issuesText(e.issues, locale) : "JSON";
    return NextResponse.json({ error: t("invalidRequest", { details }) }, { status: 400 });
  }
  console.error(e);
  return NextResponse.json({ error: t("unexpected") }, { status: 500 });
}

/** The body sent, read no further than the limit (whatever length it announces, or none) */
export async function readCapped(req: Request, max: number, tooLarge: () => Error): Promise<Uint8Array<ArrayBuffer>> {
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const r = reader ? await reader.read() : { done: true as const, value: undefined };
    if (r.done) break;
    size += r.value.byteLength;
    if (size > max) {
      await reader?.cancel();
      throw tooLarge();
    }
    chunks.push(r.value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
