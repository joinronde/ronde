import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { validUnsubscribe } from "@/lib/server/weekly";
import { stopWeeklySummary } from "./actions";

export async function generateMetadata() {
  const t = await getTranslations("weekly.page");
  return { title: `${t("title")} · Ronde`, robots: { index: false } };
}

/**
 * The link at the bottom of the weekly summary: it asks before turning the summary off (a mail scanner opening
 * the link changes nothing), without signing in. The account page turns it back on.
 */
export default async function StopWeeklySummary({ searchParams }: { searchParams: Promise<{ u?: string; t?: string; done?: string }> }) {
  const { u = "", t: token = "", done } = await searchParams;
  const t = await getTranslations("weekly.page");
  const valid = !!u && validUnsubscribe(u, token);
  return (
    <main id="main" className="state-page">
      {!valid ? (
        <h1>{t("invalid")}</h1>
      ) : done ? (
        <>
          <h1>{t("done")}</h1>
          <p className="muted">{t("body")}</p>
        </>
      ) : (
        <>
          <h1>{t("title")}</h1>
          <p className="muted">{t("body")}</p>
          <form action={stopWeeklySummary}>
            <input type="hidden" name="u" value={u} />
            <input type="hidden" name="t" value={token} />
            <button type="submit" className="btn primary">
              {t("button")}
            </button>
          </form>
        </>
      )}
      <Link href="/" className="link">
        {t("back")}
      </Link>
    </main>
  );
}
