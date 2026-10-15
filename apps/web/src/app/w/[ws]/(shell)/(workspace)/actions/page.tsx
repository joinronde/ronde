import { getTranslations } from "next-intl/server";
import { ActionsView } from "@/components/workspace/actions";
import { pageWorkspace } from "@/lib/server/authz";
import { hostsMeetings, listActions, ownMeetings } from "@/lib/server/my-actions";
import { listTrackers, trackersOn } from "@/lib/server/trackers";

export async function generateMetadata() {
  const t = await getTranslations("actions");
  return { title: `${t("title")} · Ronde` };
}

export default async function ActionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await pageWorkspace((await params).ws);
  const hosts = await hostsMeetings(ctx);
  const view = hosts && (await searchParams).view === "hosted" ? "hosted" : "mine";
  const [actions, meetings, trackers] = await Promise.all([
    listActions(ctx, view),
    ownMeetings(ctx),
    trackersOn(ctx.workspace) ? listTrackers(ctx) : [],
  ]);
  return (
    <ActionsView
      slug={ctx.workspace.slug}
      view={view}
      hosts={hosts}
      me={ctx.member.personId}
      actions={actions}
      meetings={meetings}
      trackers={trackers.map((x) => ({ id: x.id, name: x.name, kind: x.kind }))}
    />
  );
}
