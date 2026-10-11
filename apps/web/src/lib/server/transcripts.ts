import "server-only";
import { prisma, scoped } from "@ronde/db";
import type { TranscriptionAccess } from "@ronde/editions/ee";
import { enterprise } from "@/ee-bridge";
import type { WorkspaceSettings } from "./authz";
import { env } from "./env";
import { featureOn, type PlanScope } from "./license";
import { personName } from "./meeting/dto";
import { outboundFetch } from "./outbound";
import { decryptSecret } from "./secrets";

// Transcript of a session (Team): the control room records the room or the call in pieces, each piece is
// turned into text by a speech-to-text service, each passage goes to the person whose turn it was. The
// sound is deleted as soon as it is transcribed; people may leave their turn out.

export const transcriptionOn = (ws: PlanScope) => featureOn("modules.transcription", ws);

export const DEFAULT_TRANSCRIPTION_URL = "https://api.openai.com/v1";
export const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";

/** Largest piece accepted: about a minute of speech at the recorder's bit rate */
export const MAX_CHUNK_BYTES = 8_000_000;
/** A piece that fails this many times is dropped: its sound is not kept */
const MAX_ATTEMPTS = 3;

/** The speech-to-text service of a workspace: its own settings, or the instance's; null when off */
export function transcriptionConfig(settings: WorkspaceSettings, ws: PlanScope): TranscriptionAccess | null {
  const t = settings.transcription;
  if (!transcriptionOn(ws) || !t?.enabled) return null;
  let apiKey = env.transcriptionKey();
  if (t.key) {
    try {
      apiKey = decryptSecret(t.key);
    } catch {
      return null;
    }
  }
  const baseUrl = t.baseUrl || env.transcriptionUrl() || DEFAULT_TRANSCRIPTION_URL;
  // OpenAI needs a key; a self-hosted server may not
  if (!apiKey && baseUrl.startsWith(DEFAULT_TRANSCRIPTION_URL)) return null;
  return {
    baseUrl,
    apiKey,
    model: t.model || env.transcriptionModel() || DEFAULT_TRANSCRIPTION_MODEL,
    language: t.language ?? "",
    fetch: outboundFetch,
  };
}

type Step = { at: number; key: string };

/** Turns a piece into passages of the transcript, then deletes its sound. Returns the passages added. */
export async function processChunk(chunkId: string): Promise<number> {
  const chunk = await prisma.audioChunk.findUnique({
    where: { id: chunkId },
    include: { session: { select: { id: true, meetingId: true, transcriptOptOut: true } } },
  });
  if (!chunk) return 0;
  const workspace = await prisma.workspace.findUnique({ where: { id: chunk.workspaceId }, select: { settings: true, plan: true } });
  const config = transcriptionConfig((workspace?.settings ?? {}) as WorkspaceSettings, workspace);
  if (!config) {
    await prisma.audioChunk.delete({ where: { id: chunk.id } });
    return 0;
  }
  let passages: { start: number; end: number; text: string }[];
  try {
    passages = await enterprise.transcription.transcribe(config, { data: chunk.data, type: chunk.type });
  } catch (e) {
    const attempts = chunk.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) await prisma.audioChunk.delete({ where: { id: chunk.id } });
    else await prisma.audioChunk.update({ where: { id: chunk.id }, data: { attempts, error: String(e).slice(0, 300) } });
    console.error(`[transcript] piece ${chunk.id} of session ${chunk.sessionId}`, e);
    return 0;
  }
  const db = scoped(prisma, chunk.workspaceId);
  const people = new Set(
    (await db.meetingParticipant.findMany({ where: { meetingId: chunk.session.meetingId }, select: { personId: true } })).map(
      (p) => p.personId,
    ),
  );
  const steps = ((chunk.steps ?? []) as Step[]).sort((a, b) => a.at - b.at);
  const startAt = chunk.startAt.getTime();
  // The step at a moment: the last one that began before it
  const stepAt = (at: number) => [...steps].reverse().find((s) => s.at <= at)?.key ?? steps[0]?.key ?? null;
  const rows = passages.flatMap((p) => {
    const at = startAt + Math.round(p.start * 1000);
    const stepKey = stepAt(at);
    const speakerId = stepKey && people.has(stepKey) ? stepKey : null;
    if (speakerId && chunk.session.transcriptOptOut.includes(speakerId)) return [];
    return [
      {
        workspaceId: chunk.workspaceId,
        sessionId: chunk.sessionId,
        at: new Date(at),
        durationMs: Math.max(0, Math.round((p.end - p.start) * 1000)),
        text: p.text.slice(0, 5000),
        stepKey,
        speakerId,
      },
    ];
  });
  if (rows.length) await db.transcriptSegment.createMany({ data: rows });
  await prisma.audioChunk.delete({ where: { id: chunk.id } });
  return rows.length;
}

/** Every minute: pieces still waiting (a restart, a failure to try again) */
export async function processPendingChunks(): Promise<number> {
  const chunks = await prisma.audioChunk.findMany({
    where: { createdAt: { lt: new Date(Date.now() - 60_000) } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  let n = 0;
  for (const c of chunks) n += await processChunk(c.id);
  return n;
}

export interface TranscriptLine {
  at: number;
  speaker: string | null;
  speakerId: string | null;
  text: string;
}

/** The transcript of a session, consecutive passages of the same person joined */
export async function sessionTranscript(db: ReturnType<typeof scoped>, sessionId: string): Promise<TranscriptLine[]> {
  const segments = await db.transcriptSegment.findMany({ where: { sessionId }, orderBy: { at: "asc" } });
  const ids = [...new Set(segments.flatMap((s) => (s.speakerId ? [s.speakerId] : [])))];
  const people = await db.person.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const name = new Map(people.map((p) => [p.id, personName(p)]));
  const lines: TranscriptLine[] = [];
  for (const s of segments) {
    const last = lines[lines.length - 1];
    if (last && last.speakerId === s.speakerId && s.at.getTime() - last.at < 5 * 60_000) last.text = `${last.text} ${s.text}`;
    else
      lines.push({
        at: s.at.getTime(),
        speakerId: s.speakerId,
        speaker: s.speakerId ? (name.get(s.speakerId) ?? null) : null,
        text: s.text,
      });
  }
  return lines;
}

/** The transcript as plain text, for the AI assistant */
export const transcriptText = (lines: TranscriptLine[], others: string) => lines.map((l) => `${l.speaker ?? others}: ${l.text}`).join("\n");
