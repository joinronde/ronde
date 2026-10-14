import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { WorkspaceTopBar } from "@/components/shell/workspace-top-bar";
import { pageWorkspace } from "@/lib/server/authz";
import { billingOn } from "@/lib/server/billing";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const ctx = await pageWorkspace(ws);
  // A payment that failed: the people who pay are told on every page, until it goes through
  const failing =
    billingOn() &&
    ctx.can("workspace.billing") &&
    !!(await ctx.db.subscription.findFirst({ where: { status: { in: ["past_due", "unpaid"] } }, select: { workspaceId: true } }));
  const t = await getTranslations("billing");
  return (
    <>
      <WorkspaceTopBar workspace={{ slug: ctx.workspace.slug, name: ctx.workspace.name }} />
      {failing && (
        <p className="note-box warn payment-failed" role="alert">
          {t("paymentFailed")} <Link href={`/w/${ctx.workspace.slug}/settings/billing`}>{t("paymentFix")}</Link>
        </p>
      )}
      <main id="main" className="page-main">
        {children}
      </main>
    </>
  );
}
