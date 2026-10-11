import "server-only";
import type { Locale } from "@ronde/i18n";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import type { ShellData } from "@/components/shell/app-shell";
import { LAST_WORKSPACE_COOKIE } from "@/lib/shared/cookies";
import { type CurrentUser, workspaceContext } from "./authz";
import { logoPath, workspaceBrand } from "./branding";
import { env } from "./env";
import { isCloud } from "./license";
import { listMeetings } from "./meetings";
import { openActionCount } from "./my-actions";
import { lockedEdition, plansUrl } from "./plans";
import { userWorkspaces } from "./workspaces";

/** What the sidebar shows: the workspaces, the meetings of the current one, the person */
export async function shellData(user: CurrentUser, slug?: string | null): Promise<ShellData> {
  const workspaces = await userWorkspaces(user.id);
  const last = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  const current = workspaces.find((w) => w.slug === slug) ?? workspaces.find((w) => w.slug === last) ?? workspaces[0] ?? null;
  const ctx = current ? await workspaceContext(current.slug) : null;
  // A paid page the plan lacks: administrators see it marked with the plan that has it, others do not see it
  const insightsLocked = ctx ? lockedEdition(ctx.workspace, "reporting.workspace") : null;
  const hints = ctx && insightsLocked ? (await plansUrl(ctx)) !== null : false;
  const [meetings, openActions, brand, me] = ctx
    ? await Promise.all([
        listMeetings(ctx, (await getLocale()) as Locale),
        openActionCount(ctx),
        workspaceBrand(ctx.workspace.id),
        // The person's photo in this workspace, for the account menu
        ctx.db.person.findUnique({ where: { id: ctx.member.personId }, select: { color: true, avatar: { select: { updatedAt: true } } } }),
      ])
    : [[], 0, null, null];
  return {
    workspace: current && ctx ? { slug: current.slug, name: current.name, logo: brand ? logoPath(current.slug, brand.logo) : null } : null,
    workspaces: workspaces.map(({ slug: s, name }) => ({ slug: s, name })),
    meetings: meetings.map((m) => ({ id: m.id, name: m.name, icon: m.icon, image: m.image, live: !!m.next?.live })),
    can: {
      manage: !!ctx?.can("workspace.manage"),
      createMeeting: !!ctx?.can("meeting.create"),
      projects: !!ctx?.can("projects.read"),
      insights: !!ctx?.can("stats.read") && (!insightsLocked || hints),
    },
    locked: { insights: insightsLocked },
    openActions,
    feedback: env.feedbackTo(),
    user: {
      name: user.name,
      email: user.email,
      // The cloud's operators administer it from their back-office
      instanceAdmin: user.instanceRole === "admin" && !isCloud(),
      personId: ctx?.member.personId ?? null,
      color: me?.color ?? 0,
      avatar: me?.avatar?.updatedAt.getTime() ?? null,
    },
  };
}
