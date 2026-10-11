import { prisma } from "@ronde/db";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { InstanceAdminView } from "@/components/instance-admin";
import type { LicenseInfo } from "@/components/license-panel";
import { enterprise } from "@/ee-bridge";
import { pageUser } from "@/lib/server/authz";
import { instanceSettings } from "@/lib/server/instance";
import { isCloud, licenseFromEnv, loadLicense, usedSeats } from "@/lib/server/license";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: `${t("title")} · Ronde` };
}

/** Server administration: its administrators only, a 404 for everyone else (and in the cloud, run from its back-office) */
export default async function AdminPage() {
  const user = await pageUser("/admin");
  if (user.instanceRole !== "admin" || isCloud()) notFound();
  const [settings, users, workspaces, meetings, license, seats] = await Promise.all([
    instanceSettings(),
    prisma.user.count(),
    prisma.workspace.count({ where: { deletedAt: null } }),
    prisma.meeting.count({ where: { archivedAt: null } }),
    loadLicense(true),
    usedSeats(),
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
  return <InstanceAdminView settings={settings} counts={{ users, workspaces, meetings }} license={info} />;
}
