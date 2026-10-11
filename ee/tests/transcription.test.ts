import { describe, expect, it } from "vitest";
import { transcribe } from "../src/transcription";

// Speech to text: the piece of sound sent once, timed passages read back

describe("transcription", () => {
  it("sends the sound with the model and the language, and reads the timed passages", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return Response.json({
        text: "Hello all",
        segments: [
          { start: 0, end: 2.5, text: " Hello" },
          { start: 2.5, end: 4, text: " all " },
        ],
      });
    }) as unknown as typeof globalThis.fetch;
    const out = await transcribe(
      { baseUrl: "https://whisper.example.org/v1/", apiKey: "", model: "Systran/faster-whisper-small", language: "fr", fetch },
      { data: new Uint8Array([1, 2, 3]), type: "audio/webm;codecs=opus" },
    );
    expect(out).toEqual([
      { start: 0, end: 2.5, text: "Hello" },
      { start: 2.5, end: 4, text: "all" },
    ]);
    expect(sent[0]!.url).toBe("https://whisper.example.org/v1/audio/transcriptions");
    const form = sent[0]!.init.body as FormData;
    expect([form.get("model"), form.get("language"), form.get("response_format")]).toEqual([
      "Systran/faster-whisper-small",
      "fr",
      "verbose_json",
    ]);
    expect((form.get("file") as File).type).toBe("audio/webm");
    // No key for a self-hosted server: no authorization header
    expect(sent[0]!.init.headers).toEqual({});
  });

  it("takes plain text from models that give no passages", async () => {
    const fetch = (async () => Response.json({ text: "Everything at once" })) as unknown as typeof globalThis.fetch;
    expect(
      await transcribe(
        { baseUrl: "https://api.openai.com/v1", apiKey: "sk", model: "gpt-4o-transcribe", language: "", fetch },
        { data: new Uint8Array([1]), type: "audio/webm" },
      ),
    ).toEqual([{ start: 0, end: 0, text: "Everything at once" }]);
  });
});
