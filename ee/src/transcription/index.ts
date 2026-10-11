// Ronde Enterprise Edition. Copyright (c) Ronde. Licensed under the Ronde Enterprise License (see ee/LICENSE).
import type { EnterpriseEdition, TranscriptionAccess } from "@ronde/editions/ee";
import { ProviderError } from "../providers";

// Speech to text with the OpenAI transcription API: OpenAI itself, or a Whisper server that speaks the same
// API (faster-whisper-server, speaches…). Each piece is sent once; its sound is deleted afterwards by Ronde.

const EXTENSION: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

export async function transcribe(
  a: TranscriptionAccess,
  audio: { data: Uint8Array; type: string },
): Promise<{ start: number; end: number; text: string }[]> {
  const type = audio.type.split(";")[0]!.trim();
  const form = new FormData();
  form.set("file", new Blob([Buffer.from(audio.data)], { type }), `audio.${EXTENSION[type] ?? "webm"}`);
  form.set("model", a.model);
  // Timed passages when the model gives them (whisper-1, Whisper servers); plain text otherwise
  form.set("response_format", a.model.startsWith("gpt-4o") ? "json" : "verbose_json");
  if (a.language) form.set("language", a.language);
  const res = await (a.fetch ?? fetch)(`${a.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: a.apiKey ? { authorization: `Bearer ${a.apiKey}` } : {},
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new ProviderError(`the transcription service answered ${res.status}`, res.status);
  const body = (await res.json()) as { text?: string; duration?: number; segments?: { start: number; end: number; text: string }[] };
  if (body.segments?.length) return body.segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })).filter((s) => s.text);
  const text = body.text?.trim() ?? "";
  return text ? [{ start: 0, end: body.duration ?? 0, text }] : [];
}

export const transcription: EnterpriseEdition["transcription"] = { transcribe };
