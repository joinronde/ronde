import { assignableRoles } from "@ronde/core/permissions";
import { getTranslations } from "next-intl/server";
import { PeopleDirectory, type PersonRow } from "@/components/workspace/people";
import { enterprise } from "@/ee-bridge";
import { pageWorkspace } from "@/lib/server/authz";
import { billingOn } from "@/lib/server/billing";
import { canSendEmail } from "@/lib/server/mailer";
import { customRolesOn, customRolesReadable } from "@/lib/server/roles";

export async function generateMetadata() {
  const t = await getTranslations("people");
  return { title: `${t("title")} · Ronde` };
}

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ invite?: string; edit?: string }>;
}) {
  const ctx = await pageWorkspace((await params).ws, "people.read");
  const { invite, edit } = await searchParams;
  const now = new Date();
  const [people, categories] = await Promise.all([
    ctx.db.person.findMany({
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        birthday: true,
        phone: true,
        jobCategoryId: true,
        color: true,
        sample: true,
        avatar: { select: { updatedAt: true } },
        userId: true,
        member: { select: { role: true, status: true, customRoleId: true } },
        invitations: {
          where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
          select: { id: true, expiresAt: true, role: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    ctx.db.jobCategory.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } }),
  ]);
  const rows: PersonRow[] = people.map((p) => {
    const invitation = p.invitations[0];
    return {
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email,
      birthday: p.birthday,
      phone: p.phone,
      jobCategoryId: p.jobCategoryId,
      color: p.color,
      avatar: p.avatar ? p.avatar.updatedAt.getTime() : null,
      hasAccount: !!p.userId,
      role: p.member?.role ?? null,
      customRoleId: p.member?.customRoleId ?? null,
      status: p.member ? "active" : invitation ? "invited" : "directory",
      invitation: invitation ? { id: invitation.id, expiresAt: invitation.expiresAt.toISOString(), role: invitation.role } : null,
      isMe: p.id === ctx.member.personId,
      sample: p.sample,
    };
  });
  return (
    <PeopleDirectory
      slug={ctx.workspace.slug}
      workspaceName={ctx.workspace.name}
      people={rows}
      categories={categories}
      canInvite={ctx.can("people.invite")}
      canManage={ctx.can("people.manage")}
      canChangeRoles={ctx.can("members.manage")}
      assignable={assignableRoles(ctx.member.role, { billing: billingOn() })}
      customRoles={
        customRolesReadable(ctx.workspace) ? (await enterprise.roles.list(ctx.db)).map((r) => ({ id: r.id, name: r.name })) : null
      }
      customRolesEditable={customRolesOn(ctx.workspace)}
      mailConfigured={canSendEmail()}
      openInvite={invite === "1"}
      openEdit={edit ?? null}
    />
  );
}
