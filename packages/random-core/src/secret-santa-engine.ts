import { createSeededRandom } from "./seeded-random";

export interface SecretSantaInputParticipant {
  id: string;
  name: string;
}

export interface SecretSantaExclusion {
  participantIds: [string, string];
}

export type SecretSantaResult =
  | { status: "success"; assignments: Array<{ giverId: string; recipientId: string }> }
  | { status: "invalid"; reason: string }
  | { status: "unsatisfiable"; reason: string };

export function assignSecretSanta(
  participants: SecretSantaInputParticipant[],
  exclusions: SecretSantaExclusion[],
  seed: string,
): SecretSantaResult {
  if (participants.length < 3) return { status: "invalid", reason: "not_enough_participants" };
  const ids = participants.map(({ id }) => id);
  if (
    new Set(ids).size !== ids.length ||
    new Set(participants.map(({ name }) => name.trim().toLocaleLowerCase())).size !== participants.length
  ) {
    return { status: "invalid", reason: "participants_must_be_unique" };
  }
  const known = new Set(ids);
  const blocked = new Map(ids.map((id) => [id, new Set([id])]));
  for (const exclusion of exclusions) {
    const [left, right] = exclusion.participantIds;
    if (left === right || !known.has(left) || !known.has(right)) return { status: "invalid", reason: "invalid_exclusion" };
    blocked.get(left)?.add(right);
    blocked.get(right)?.add(left);
  }
  const random = createSeededRandom(seed);
  const orderedGivers = [...ids].sort((left, right) => (blocked.get(right)?.size ?? 0) - (blocked.get(left)?.size ?? 0));
  const used = new Set<string>();
  const assignments = new Map<string, string>();
  const visit = (position: number): boolean => {
    if (position === orderedGivers.length) return true;
    const giver = orderedGivers[position];
    const candidates = random.shuffle(ids).filter((recipient) => !used.has(recipient) && !blocked.get(giver)?.has(recipient));
    for (const recipient of candidates) {
      assignments.set(giver, recipient);
      used.add(recipient);
      if (visit(position + 1)) return true;
      assignments.delete(giver);
      used.delete(recipient);
    }
    return false;
  };
  if (!visit(0)) return { status: "unsatisfiable", reason: "no_valid_assignment" };
  return { status: "success", assignments: ids.map((giverId) => ({ giverId, recipientId: assignments.get(giverId) ?? "" })) };
}
