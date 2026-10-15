import "server-only";
import { prisma, type ScopedClient, type ScopedTx, scoped } from "@ronde/db";
import { resolveLocale, translator } from "@ronde/i18n";
import { OpError } from "./errors";

// A person's rights over their data (GDPR art. 15, 17, 20): everything Ronde holds about their account, as a
// file; and erasing it. In a workspace, what the person said stays the team's (minutes, actions, check-ins), but
// signed by a former member: their name, address, number, birthday, photo and absences go.

type Db = ScopedClient | ScopedTx;

/** Everything about an account, readable and reusable (JSON) */
export async function exportAccount(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      emailVerified: true,
      locale: true,
      timezone: true,
      twoFactorEnabled: true,
      createdAt: true,
      accounts: { select: { providerId: true, createdAt: true } },
      passkeys: { select: { name: true, createdAt: true } },
      authSessions: { select: { createdAt: true, expiresAt: true, ipAddress: true, userAgent: true } },
      prefs: { select: { key: true, value: true } },
      pushDevices: { select: { label: true, createdAt: true } },
      feedback: { select: { kind: true, message: true, createdAt: true } },
      memberships: {
        select: { workspaceId: true, personId: true, role: true, createdAt: true, workspace: { select: { name: true, slug: true } } },
      },
    },
  });
  const workspaces = [];
  for (const m of user.memberships) {
    const db = scoped(prisma, m.workspaceId);
    const [person, meetings, items, actions, attendance, absences, kudosGiven, kudosReceived] = await Promise.all([
      db.person.findFirst({
        where: { id: m.personId },
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          birthday: true,
          locale: true,
          jobCategory: { select: { name: true } },
        },
      }),
      db.meetingParticipant.findMany({ where: { personId: m.personId }, select: { role: true, meeting: { select: { name: true } } } }),
      db.checkInItem.findMany({ where: { personId: m.personId }, select: { sectionKey: true, text: true, createdAt: true } }),
      db.action.findMany({
        where: { ownerId: m.personId },
        select: { text: true, status: true, progress: true, createdAt: true, doneAt: true },
      }),
      db.attendance.findMany({ where: { personId: m.personId }, select: { occurrenceKey: true, status: true } }),
      db.absence.findMany({ where: { personId: m.personId }, select: { from: true, to: true, note: true } }),
      db.kudo.findMany({ where: { fromId: m.personId }, select: { text: true, createdAt: true } }),
      db.kudo.findMany({ where: { toId: m.personId }, select: { text: true, createdAt: true } }),
    ]);
    workspaces.push({
      workspace: m.workspace,
      role: m.role,
      memberSince: m.createdAt,
      profile: person,
      meetings: meetings.map((p) => ({ meeting: p.meeting.name, role: p.role })),
      checkInItems: items,
      actions,
      attendance,
      absences,
      kudos: { given: kudosGiven, received: kudosReceived },
    });
  }
  const { memberships: _, ...account } = user;
  return { exportedAt: new Date().toISOString(), account, workspaces };
}

/**
 * Erases a person of a workspace's directory: their card keeps its place in the team's history under "Former
 * member", without name, address, number, birthday, photo, absences or access; they leave every meeting.
 */
export async function erasePerson(db: Db, workspaceId: string, personId: string): Promise<void> {
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { locale: true } });
  const label = translator(resolveLocale(ws.locale), "people")("formerMember");
  await db.workspaceMember.deleteMany({ where: { personId } });
  await db.invitation.deleteMany({ where: { personId } });
  await db.absence.deleteMany({ where: { OR: [{ personId }, { delegateId: personId }] } });
  await db.inboxItem.deleteMany({ where: { personId } });
  await db.personAvatar.deleteMany({ where: { personId } });
  await db.meetingParticipant.deleteMany({ where: { personId } });
  await db.person.update({
    where: { id: personId },
    data: {
      firstName: label,
      lastName: "",
      // A reserved domain: nothing is ever sent there (isSampleAddress)
      email: `erased-${personId}@erased.invalid`,
      phone: null,
      birthday: null,
      handles: {},
      externalId: null,
      userId: null,
      active: false,
      deprovisionedAt: new Date(),
    },
  });
  // Minutes already archived name them: the name there goes too
  const sessions = await db.session.findMany({ where: { status: "archived" }, select: { id: true, record: true } });
  for (const s of sessions) {
    const record = s.record as {
      names?: Record<string, string>;
      participants?: { id: string; name: string }[];
      absent?: { id: string; name: string }[];
    } | null;
    if (!record) continue;
    const named =
      !!record.names?.[personId] ||
      !!record.participants?.some((p) => p.id === personId) ||
      !!record.absent?.some((p) => p.id === personId);
    if (!named) continue;
    const rename = <T extends { id: string; name: string }>(list?: T[]) =>
      list?.map((p) => (p.id === personId ? { ...p, name: label } : p));
    await db.session.update({
      where: { id: s.id },
      data: {
        record: {
          ...record,
          ...(record.names ? { names: { ...record.names, [personId]: label } } : {}),
          ...(record.participants ? { participants: rename(record.participants) } : {}),
          ...(record.absent ? { absent: rename(record.absent) } : {}),
        },
      },
    });
  }
}

/** The workspaces where the person is the last owner: they hand them over or delete them first */
export async function ownedAlone(userId: string): Promise<string[]> {
  const owned = await prisma.workspaceMember.findMany({
    where: { userId, role: "owner", status: "active", workspace: { deletedAt: null } },
    select: { workspaceId: true, workspace: { select: { name: true } } },
  });
  const alone: string[] = [];
  for (const o of owned) {
    const owners = await prisma.workspaceMember.count({ where: { workspaceId: o.workspaceId, role: "owner", status: "active" } });
    if (owners <= 1) alone.push(o.workspace.name);
  }
  return alone;
}

/**
 * Deletes an account, confirmed by typing its address: its cards erased in every workspace (see erasePerson),
 * its sign-in, sessions, devices and preferences gone, its name taken out of the audit logs.
 */
export async function deleteAccount(user: { id: string; email: string }, confirmation: string): Promise<void> {
  if (confirmation.trim().toLowerCase() !== user.email.toLowerCase()) throw new OpError("confirmationMismatch");
  const alone = await ownedAlone(user.id);
  if (alone.length) throw new OpError("accountOwnsWorkspaces", { workspaces: alone.join(", ") });
  const cards = await prisma.person.findMany({ where: { userId: user.id }, select: { id: true, workspaceId: true } });
  for (const c of cards) await erasePerson(scoped(prisma, c.workspaceId), c.workspaceId, c.id);
  await prisma.auditLog.updateMany({ where: { actorUserId: user.id }, data: { actorLabel: "—" } });
  await prisma.user.delete({ where: { id: user.id } });
}
