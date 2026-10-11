import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/authz";
import { userWorkspaces } from "@/lib/server/workspaces";
import { LAST_WORKSPACE_COOKIE } from "@/lib/shared/cookies";

export const dynamic = "force-dynamic";

// Home: the last workspace opened, otherwise the first one, otherwise onboarding
export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const workspaces = await userWorkspaces(user.id);
  if (!workspaces.length) redirect("/onboarding");
  const last = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  redirect(`/w/${(workspaces.find((w) => w.slug === last) ?? workspaces[0]!).slug}`);
}
