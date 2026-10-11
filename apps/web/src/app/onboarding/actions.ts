"use server";

import { run } from "@/lib/server/action";
import { auditJoin } from "@/lib/server/audit";
import { requireUser } from "@/lib/server/authz";
import { acceptInvitationById, createWorkspace, suggestSlug } from "@/lib/server/workspaces";

export async function createWorkspaceAction(input: { name: string; slug: string; locale: string; timezone: string }) {
  return run(async () => createWorkspace(await requireUser(), input));
}

export async function suggestSlugAction(name: string) {
  return run(async () => {
    await requireUser();
    return suggestSlug(name);
  });
}

export async function joinInvitationAction(invitationId: string) {
  return run(async () => auditJoin(await acceptInvitationById(await requireUser(), invitationId)));
}
