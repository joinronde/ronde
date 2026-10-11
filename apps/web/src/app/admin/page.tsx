import { prisma } from "@ronde/db";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminFeedback } from "@/components/admin-feedback";
import { InstanceAdminView } from "@/components/instance-admin";
import type { LicenseInfo } from "@/components/license-panel";
import { enterprise } from "@/ee-bridge";
import { pageUser } from "@/lib/server/authz";
import { env } from "@/lib/server/env";
import { listFeedback } from "@/lib/server/feedback";
import { instanceSettings } from "@/lib/server/instance";
import { isCloud, licenseFromEnv, loadLicense, usedSeats } from "@/lib/server/license";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: `${t("title")} · Ronde` };
}

/** Server administration: its administrators only, a 404 for everyone else (and in the cloud, run from its back-office) */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ feedback?: string }> }) {
  const user = await pageUser("/admin");
  if (user.instanceRole !== "admin" || isCloud()) notFound();
  const archived = (await searchParams).feedback === "archived";
  const [settings, users, workspaces, meetings, license, seats, feedback, unread] = await Promise.all([
    instanceSettings(),
    prisma.user.count(),
    prisma.workspace.count({ where: { deletedAt: null } }),
    prisma.meeting.count({ where: { archivedAt: null } }),
    loadLicense(true),
    usedSeats(),
    listFeedback({ status: archived ? "archived" : undefined }),
    prisma.feedback.count({ where: { status: "new" } }),
  ]);
  const info: LicenseInfo = {
    status: license.status,
    reason: license.status === "invalid" ? license.reason : undefined,
    ...("license" in license
      ? {
          customer: license.license.customer,
          edition: license.license.edition,
          seats: license.license.seats,
          expiresAt: license.license.expiresAt,
        }
      : {}),
    graceEndsAt: license.status === "grace" ? license.graceEndsAt : undefined,
    usedSeats: seats,
    fromEnv: licenseFromEnv(),
    build: enterprise.kind,
  };
  // The messages of "Send feedback", unless the instance turned the button off and none are left
  const showFeedback = !!env.feedbackTo() || feedback.length > 0 || archived;
  return (
    <InstanceAdminView settings={settings} counts={{ users, workspaces, meetings, feedback: showFeedback ? unread : null }} license={info}>
      {showFeedback && <AdminFeedback items={feedback} archived={archived} unread={unread} />}
    </InstanceAdminView>
  );
}
