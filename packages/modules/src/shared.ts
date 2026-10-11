import type { Viewer } from "@ronde/core/types";
import { HOST_ID } from "@ronde/core/util";
import { type OpContext, OpError } from "@ronde/module-sdk";
import { z } from "zod";

export const str = (max = 500) => z.string().trim().max(max);
export const none = z.object({});

/** Identity recorded for a raised hand, a reaction or a kudo: the participant, or "host" for a host who is not one */
export const actorId = (v: Viewer) => v.memberId ?? (v.isHost ? HOST_ID : null);

export function requireActor(v: Viewer): string {
  const by = actorId(v);
  if (!by) throw new OpError("notAMember");
  return by;
}

/** A person id sent by the browser must be a participant of this meeting */
export async function requireParticipant(
  { db, meetingId }: Pick<OpContext, "db" | "meetingId">,
  personId: string,
  error: "unknownMember" | "unknownRecipient" | "unknownOwner" = "unknownMember",
) {
  if (!(await db.meetingParticipant.findFirst({ where: { meetingId, personId }, select: { id: true } }))) throw new OpError(error);
}
