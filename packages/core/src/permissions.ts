// Who may do what. Workspace roles give workspace-wide permissions; meeting roles add permissions on one
// meeting. Workspace owners and admins act as hosts of every meeting of their workspace.

export const WORKSPACE_ROLES = ["owner", "admin", "billing", "organizer", "member", "guest"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const MEETING_ROLES = ["host", "cohost", "participant", "observer"] as const;
export type MeetingRole = (typeof MEETING_ROLES)[number];

export const PERMISSIONS = [
  // Workspace
  "workspace.manage",
  "workspace.billing",
  "workspace.delete",
  "members.manage",
  "people.read",
  "people.manage",
  "people.invite",
  "templates.manage",
  "connectors.manage",
  "audit.read",
  "meeting.create",
  "projects.read",
  "projects.create",
  "projects.manage",
  // Meeting
  "meeting.read",
  "meeting.configure",
  "meeting.delete",
  "participants.manage",
  "session.run",
  "session.participate",
  "session.observe",
  "checkin.write.own",
  "checkin.read.all",
  "checkin.write.any",
  "notes.read",
  "minutes.edit",
  "history.read",
  "stats.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MEETING_PERMISSIONS: readonly Permission[] = [
  "meeting.read",
  "meeting.configure",
  "meeting.delete",
  "participants.manage",
  "session.run",
  "session.participate",
  "session.observe",
  "checkin.write.own",
  "checkin.read.all",
  "checkin.write.any",
  "notes.read",
  "minutes.edit",
  "history.read",
  "stats.read",
];

const ALL: readonly Permission[] = PERMISSIONS;

const MEMBER: readonly Permission[] = ["people.read", "meeting.create", "templates.manage", "projects.read", "projects.create"];

export const WORKSPACE_GRANTS: Record<WorkspaceRole, readonly Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== "workspace.billing" && p !== "workspace.delete"),
  // The person who pays: the plan, the invoices and the payment method, nothing else to administer
  billing: ["people.read", "projects.read", "workspace.billing"],
  // A member who sets meetings up: creates them whatever the workspace's policy, invites the people they need
  organizer: [...MEMBER, "people.invite"],
  member: MEMBER,
  guest: [],
};

export const MEETING_GRANTS: Record<MeetingRole, readonly Permission[]> = {
  host: MEETING_PERMISSIONS,
  cohost: MEETING_PERMISSIONS.filter((p) => p !== "meeting.configure" && p !== "meeting.delete" && p !== "participants.manage"),
  participant: ["meeting.read", "session.participate", "checkin.write.own", "checkin.read.all", "history.read"],
  observer: ["meeting.read", "session.observe", "history.read"],
};

/** What the current person may do: their workspace role and, inside a meeting, their meeting role */
export interface Principal {
  userId: string;
  personId: string;
  workspaceId: string;
  workspaceRole: WorkspaceRole;
  meetingRole?: MeetingRole | null;
  /** Permissions added by a custom role of the workspace (Enterprise); meeting ones apply to every meeting */
  extra?: readonly Permission[];
}

/** What a custom role may grant: anything but owning the workspace (billing, deletion) */
export const CUSTOM_ROLE_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (p) => p !== "workspace.billing" && p !== "workspace.delete",
);

/** Workspace policy: who may create meetings ("admins": the organizers and the administrators) */
export type MeetingCreationPolicy = "members" | "admins";

/** Roles that create meetings even when the workspace keeps that to its administrators */
const MEETING_MAKERS: readonly WorkspaceRole[] = ["owner", "admin", "organizer"];

export function can(p: Principal, permission: Permission, policy: { meetingCreation?: MeetingCreationPolicy } = {}): boolean {
  // A custom role granting meeting creation holds whatever the policy: it is given on purpose
  if (permission === "meeting.create" && policy.meetingCreation === "admins")
    return MEETING_MAKERS.includes(p.workspaceRole) || !!p.extra?.includes("meeting.create");
  if (WORKSPACE_GRANTS[p.workspaceRole].includes(permission)) return true;
  if (p.extra?.includes(permission)) return true;
  return !!p.meetingRole && MEETING_GRANTS[p.meetingRole].includes(permission);
}

/**
 * Roles a person may hand out: never more than their own. Billing goes with the owner (an administrator has no
 * access to it), and only where the workspace pays for a plan (`billing`: in the cloud). A custom role that
 * invites, manages members or manages people (`extra`, a "people manager") hands out the roles of an organizer,
 * member and guest, never above the person's own built-in role: a member gives "member" and "guest", a guest
 * only "guest".
 */
/** Permissions of a custom role that act on people's seats: inviting, changing roles, removing */
const PEOPLE_MANAGING: readonly Permission[] = ["people.invite", "members.manage", "people.manage"];

/** How far each built-in role reaches, to tell stepping down from stepping up */
export const ROLE_RANK: Record<WorkspaceRole, number> = { guest: 0, member: 1, organizer: 2, billing: 2, admin: 3, owner: 4 };

export function assignableRoles(
  role: WorkspaceRole,
  { billing = false, extra = [] }: { billing?: boolean; extra?: readonly Permission[] } = {},
): WorkspaceRole[] {
  const roles: WorkspaceRole[] =
    role === "owner"
      ? ["owner", "admin", "billing", "organizer", "member", "guest"]
      : role === "admin"
        ? ["admin", "organizer", "member", "guest"]
        : role === "organizer"
          ? ["member", "guest"]
          : PEOPLE_MANAGING.some((p) => extra.includes(p))
            ? role === "member"
              ? ["member", "guest"]
              : role === "guest"
                ? ["guest"]
                : []
            : [];
  return billing ? roles : roles.filter((r) => r !== "billing");
}

/** A project is managed by the people allowed to manage every project, and by its lead */
export const canManageProject = (p: Principal, project: { leadId: string | null }) =>
  can(p, "projects.manage") || (!!project.leadId && project.leadId === p.personId);
