import { can, type Permission, type WorkspaceRole } from "@ronde/core/permissions";
import { DEFAULT_SECTIONS } from "@ronde/core/util";
import { prisma, scoped } from "@ronde/db";
import type { WorkspaceContext } from "@/lib/server/authz";
import { type MeetingCtx, meetingLinks } from "@/lib/server/meeting/context";

// Workspaces and meetings for integration tests, written with the plain client

export interface Fixture {
  workspaceId: string;
  meetingId: string;
  hostPersonId: string;
  memberId: string;
  sessionId: string;
  topicId: string;
  actionId: string;
  interactionId: string;
  kudoId: string;
  commentId: string;
  /** Occurrence of the schedule of the current session */
  occurrenceKey: string;
  connectorId: string;
  ruleId: string;
  retroCardId: string;
  retroGroupId: string;
  pokerItemId: string;
  pollId: string;
  /** A project of the workspace the meeting follows, with its sheet and an item about it */
  projectId: string;
  ctx: MeetingCtx;
}

let n = 0;
export async function workspace(slug: string) {
  const ws = await prisma.workspace.create({ data: { slug, name: slug } });
  const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `host@${slug}.test`, name: `Host ${slug}` } });
  const host = await prisma.person.create({ data: { workspaceId: ws.id, userId: user.id, email: user.email, firstName: "Host" } });
  const member = await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id, personId: host.id, role: "owner" } });
  return { ws, user, host, member };
}

export async function meeting(w: Awaited<ReturnType<typeof workspace>>, name: string): Promise<Fixture> {
  const workspaceId = w.ws.id;
  const other = await prisma.person.create({ data: { workspaceId, email: `p${++n}@${w.ws.slug}.test`, firstName: `Person ${n}` } });
  const m = await prisma.meeting.create({ data: { workspaceId, name } });
  const meetingId = m.id;
  await prisma.section.createMany({
    data: DEFAULT_SECTIONS.map((s, position) => ({
      workspaceId,
      meetingId,
      key: s.key,
      label: s.label,
      role: s.role,
      input: s.input,
      position,
    })),
  });
  await prisma.meetingParticipant.createMany({
    data: [
      { workspaceId, meetingId, personId: w.host.id, role: "host", position: 0 },
      { workspaceId, meetingId, personId: other.id, role: "participant", position: 1 },
    ],
  });
  const rule = await prisma.scheduleRule.create({
    data: { workspaceId, meetingId, freq: "weekly", byDay: [1], startDate: "2030-01-07", time: "10:00" },
  });
  const occurrenceKey = `${rule.id}:2030-01-07`;
  const session = await prisma.session.create({
    data: {
      workspaceId,
      meetingId,
      date: "2030-01-07",
      occurrenceKey,
      order: [w.host.id, other.id],
      startedAt: new Date(),
      stepKey: "intro",
    },
  });
  const sessionId = session.id;
  await prisma.checkIn.create({ data: { workspaceId, meetingId, personId: other.id } });
  const item = await prisma.checkInItem.create({
    data: { workspaceId, meetingId, personId: other.id, sectionKey: "done", role: "achievement", text: "shipped" },
  });
  await prisma.note.create({ data: { workspaceId, sessionId, key: "intro", text: "note" } });
  const topic = await prisma.topic.create({ data: { workspaceId, meetingId, text: "topic", byId: other.id } });
  await prisma.topicVote.create({ data: { workspaceId, topicId: topic.id, personId: other.id } });
  const action = await prisma.action.create({ data: { workspaceId, meetingId, text: "action", ownerId: other.id } });
  const interaction = await prisma.interaction.create({ data: { workspaceId, sessionId, type: "hand", byId: other.id, stepKey: "intro" } });
  const kudo = await prisma.kudo.create({ data: { workspaceId, sessionId, fromId: other.id, toId: w.host.id, text: "thanks" } });
  const comment = await prisma.checkInComment.create({
    data: { workspaceId, sessionId, ownerId: other.id, itemId: item.id, byId: other.id, text: "nice" },
  });
  await prisma.mood.create({ data: { workspaceId, sessionId, personId: other.id, value: 4 } });
  await prisma.icebreakerAnswer.create({ data: { workspaceId, sessionId, byId: other.id, text: "answer" } });

  const role: WorkspaceRole = "owner";
  const principal = { userId: w.user.id, personId: w.host.id, workspaceId, workspaceRole: role };
  const ws: WorkspaceContext = {
    user: { id: w.user.id, name: w.user.name, email: w.user.email, image: null, locale: null, timezone: null, instanceRole: "user" },
    workspace: { id: workspaceId, slug: w.ws.slug, name: w.ws.name, locale: "en", timezone: "UTC", plan: "community", settings: {} },
    member: { id: w.member.id, personId: w.host.id, role },
    principal,
    db: scoped(prisma, workspaceId),
    can: (p: Permission) => can(principal, p),
  };
  const allowed = (p: Permission) => can({ ...principal, meetingRole: "host" }, p);
  const ctx: MeetingCtx = {
    ws,
    workspace: ws.workspace,
    meeting: m,
    role: "host",
    viewer: {
      userId: w.user.id,
      personId: w.host.id,
      email: w.user.email,
      name: w.user.name,
      memberId: w.host.id,
      isHost: true,
      isAdmin: true,
    },
    links: meetingLinks(w.ws.slug, w.ws.name, meetingId),
    can: allowed,
  };
  const connector = await prisma.connector.create({
    data: { workspaceId, kind: "webhook", name: "Hook", config: { url: "https://hooks.example.org/ronde" } },
  });
  const notifyRule = await prisma.notificationRule.create({
    data: { workspaceId, meetingId, connectorId: connector.id, event: "minutes_published" },
  });
  const retroGroup = await prisma.retroGroup.create({ data: { workspaceId, sessionId, column: "well", title: "group" } });
  const retroCard = await prisma.retroCard.create({
    data: { workspaceId, sessionId, column: "well", authorId: other.id, text: "note", groupId: retroGroup.id },
  });
  await prisma.retroVote.create({ data: { workspaceId, groupId: retroGroup.id, personId: other.id } });
  const pokerItem = await prisma.pokerItem.create({ data: { workspaceId, sessionId, title: "story" } });
  await prisma.pokerVote.create({ data: { workspaceId, itemId: pokerItem.id, personId: other.id, value: "3" } });
  const poll = await prisma.poll.create({ data: { workspaceId, sessionId, question: "poll", kind: "single", options: ["a", "b"] } });
  await prisma.pollAnswer.create({ data: { workspaceId, pollId: poll.id, personId: other.id, values: ["a"] } });
  const project = await prisma.project.create({ data: { workspaceId, slug: `project-${n}`, name: `Project ${n}`, leadId: other.id } });
  await prisma.projectMember.create({ data: { workspaceId, projectId: project.id, personId: other.id } });
  await prisma.meetingProject.create({ data: { workspaceId, meetingId, projectId: project.id } });
  await prisma.projectUpdate.create({ data: { workspaceId, meetingId, projectId: project.id, health: "onTrack", headline: "sheet" } });
  await prisma.checkInItem.create({
    data: {
      workspaceId,
      meetingId,
      personId: other.id,
      projectId: project.id,
      sectionKey: "done",
      role: "achievement",
      text: "project work",
    },
  });
  return {
    workspaceId,
    meetingId,
    hostPersonId: w.host.id,
    memberId: other.id,
    sessionId,
    topicId: topic.id,
    actionId: action.id,
    interactionId: interaction.id,
    kudoId: kudo.id,
    commentId: comment.id,
    occurrenceKey,
    connectorId: connector.id,
    ruleId: notifyRule.id,
    retroCardId: retroCard.id,
    retroGroupId: retroGroup.id,
    pokerItemId: pokerItem.id,
    pollId: poll.id,
    projectId: project.id,
    ctx,
  };
}
