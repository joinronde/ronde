import { prisma } from "@ronde/db";
import { getTranslations } from "next-intl/server";
import { AccountNotificationsView } from "@/components/workspace/account";
import { pageUser } from "@/lib/server/authz";
import { env } from "@/lib/server/env";
import { pushDevices, pushKinds, pushOn } from "@/lib/server/push";
import { WEEKLY_OFF } from "@/lib/server/weekly";
import { userWorkspaces } from "@/lib/server/workspaces";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("account");
  return { title: `${t("tabs.notifications")} · ${t("title")} · Ronde` };
}

/** What reaches the person outside the app: push notifications, the weekly summary, their calendar */
export default async function AccountNotificationsPage() {
  const user = await pageUser("/account/notifications");
  const [workspaces, weeklyOff, devices, kinds] = await Promise.all([
    userWorkspaces(user.id),
    prisma.userPref.findUnique({ where: { userId_key: { userId: user.id, key: WEEKLY_OFF } } }),
    pushDevices(user.id),
    pushKinds(user.id),
  ]);
  return (
    <AccountNotificationsView
      weekly={!weeklyOff}
      inWorkspace={workspaces.length > 0}
      push={{
        available: pushOn(),
        publicKey: env.webPushPublicKey(),
        devices: devices.map((d) => ({ id: d.id, endpoint: d.endpoint, label: d.label, createdAt: d.createdAt.toISOString() })),
        kinds,
      }}
    />
  );
}
