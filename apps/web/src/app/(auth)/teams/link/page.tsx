import { getTranslations } from "next-intl/server";
import { TeamsLinkForm } from "@/components/auth/teams-link-form";
import { pageUser } from "@/lib/server/authz";
import { linkChoices, readLinkToken } from "@/lib/server/teams";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("teams.link");
  return { title: `${t("title")} · Ronde` };
}

/** "Link to Ronde", from the card the Teams app posted in a channel: pick the workspace the team goes with */
export default async function TeamsLinkPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const token = ((await searchParams).t ?? "").slice(0, 4000);
  const user = await pageUser(`/teams/link?t=${encodeURIComponent(token)}`);
  const ref = readLinkToken(token);
  return (
    <TeamsLinkForm
      token={token}
      team={ref ? { name: ref.teamName, channel: ref.channelName } : null}
      choices={ref ? await linkChoices(user.id) : []}
    />
  );
}
