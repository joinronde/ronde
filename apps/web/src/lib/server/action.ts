import "server-only";
import { translator } from "@ronde/i18n";
import { unstable_rethrow } from "next/navigation";
import { AppError } from "./errors";
import { requestLocale } from "./locale";

/** Outcome of a server action, with an error message the interface shows as is */
export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/** Runs a server action body and turns failures into a translated message (redirects pass through) */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    const t = translator(await requestLocale(), "errors");
    if (e instanceof AppError) return { ok: false, error: t(e.key, e.values) };
    console.error(e);
    return { ok: false, error: t("unexpected") };
  }
}
