"use server";

import { run } from "@/lib/server/action";
import { auditJoin } from "@/lib/server/audit";
import { requireUser } from "@/lib/server/authz";
import { acceptInvitation } from "@/lib/server/workspaces";

export async function acceptInvitationAction(token: string) {
  return run(async () => auditJoin(await acceptInvitation(await requireUser(), token)));
}
