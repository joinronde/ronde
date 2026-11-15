import { LostTable } from "@ronde/ui/lost-table";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

// A page of the workspace that does not exist (a project, a person, a page of a plan without payments): the
// sidebar stays, so the way on is right there
export default async function WorkspaceNotFound() {
  const t = await getTranslations("states");
  return (
    <div className="state-page lost">
      <LostTable />
      <h1>{t("notFoundTitle")}</h1>
      <p className="muted">{t("notFoundBody")}</p>
      <Link href="/" className="btn primary">
        {t("home")}
      </Link>
    </div>
  );
}
