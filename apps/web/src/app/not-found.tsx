import { LostTable } from "@ronde/ui/lost-table";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("states");
  return { title: `${t("notFoundTitle")} · Ronde` };
}

export default async function NotFound() {
  const t = await getTranslations("states");
  return (
    <main id="main" className="state-page lost">
      <LostTable />
      <h1>{t("notFoundTitle")}</h1>
      <p className="muted">{t("notFoundBody")}</p>
      <Link href="/" className="btn primary">
        {t("home")}
      </Link>
    </main>
  );
}
