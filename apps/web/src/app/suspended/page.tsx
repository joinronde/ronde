import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { pageUser, suspendedFor } from "@/lib/server/authz";

export async function generateMetadata() {
  const t = await getTranslations("states");
  return { title: `${t("suspendedTitle")} · Ronde` };
}

// Where the pages of a workspace suspended by the Ronde team lead its members
export default async function Suspended({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w = "" } = await searchParams;
  await pageUser(`/w/${w}`);
  const workspace = await suspendedFor(w);
  if (!workspace) notFound();
  const t = await getTranslations("states");
  return (
    <main id="main" className="state-page">
      <h1>{t("suspendedTitle")}</h1>
      <p className="muted">{t("suspendedBody", { workspace: workspace.name })}</p>
      <Link href="/" className="btn primary">
        {t("suspendedBack")}
      </Link>
    </main>
  );
}
