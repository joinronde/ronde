import "server-only";
import { type AgendaBlock, agendaOf } from "@ronde/core/agenda";
import { requireActor, requireParticipant, str } from "@ronde/modules/shared";
import { z } from "zod";
import { AccessError, OpError } from "../../errors";
import { deliver } from "../../inbox";
import { defineOp } from "./define";

// Slides of the agenda: what people post on an irritants slide, from the moment the session is open (before it
// starts too, so they can be raised early), and the host turning one into an action

/** Most items a person posts on one slide */
export const SLIDE_ITEMS_PER_PERSON = 20;

/** The slide of the meeting's agenda that takes items, or "not found" */
function postableSlide(meeting: { agenda: unknown }, blockId: string): Extract<AgendaBlock, { type: "slide" }> {
  const block = agendaOf(meeting.agenda).find((b) => b.id === blockId);
  if (block?.type !== "slide" || block.kind !== "irritants") throw new OpError("notFound");
  return block;
}

export const slideOps = [
  defineOp({
    name: "slide.item.add",
    permission: "session.participate",
    session: "read",
    input: z.object({ blockId: str(20), text: str(300).min(1) }),
    run: async ({ db, m, workspaceId, requireSession }, o) => {
      const s = requireSession();
      if (s.endedAt) throw new OpError("slideClosed");
      postableSlide(m.meeting, o.blockId);
      const authorId = requireActor(m.viewer);
      if ((await db.slideItem.count({ where: { sessionId: s.id, blockId: o.blockId, authorId } })) >= SLIDE_ITEMS_PER_PERSON)
        throw new OpError("slideTooManyItems");
      await db.slideItem.create({ data: { workspaceId, sessionId: s.id, blockId: o.blockId, authorId, text: o.text } });
    },
  }),
  defineOp({
    name: "slide.item.delete",
    // Its author takes it back; the host removes any
    permission: "session.participate",
    session: "read",
    input: z.object({ id: str(50) }),
    run: async ({ db, m, requireSession }, o) => {
      const s = requireSession();
      const mine = m.viewer.isHost ? {} : { authorId: requireActor(m.viewer) };
      const { count } = await db.slideItem.deleteMany({ where: { id: o.id, sessionId: s.id, ...mine } });
      if (!count) throw new AccessError(403, "ownSlideItemsOnly");
    },
  }),
  defineOp({
    name: "slide.item.toAction",
    permission: "session.run",
    session: "read",
    input: z.object({ id: str(50), ownerId: str(50), text: str(300).min(1).optional() }),
    run: async ({ db, m, meetingId, workspaceId, requireSession }, o) => {
      const s = requireSession();
      const item = await db.slideItem.findFirst({ where: { id: o.id, sessionId: s.id } });
      if (!item) throw new OpError("notFound");
      if (item.actionId) throw new OpError("slideItemTracked");
      await requireParticipant({ db, meetingId }, o.ownerId, "unknownOwner");
      const text = o.text ?? item.text.slice(0, 300);
      await deliver(db, workspaceId, {
        to: [o.ownerId],
        kind: "action.assigned",
        actorId: m.ws.member.personId,
        meetingId,
        data: { text },
        href: "/actions",
      });
      const action = await db.action.create({
        data: {
          workspaceId,
          meetingId,
          text,
          ownerId: o.ownerId,
          originDate: s.date,
          originText: item.text,
          originStep: item.blockId,
        },
      });
      await db.slideItem.update({ where: { id: item.id }, data: { actionId: action.id } });
    },
  }),
];
