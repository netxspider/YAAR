import "server-only";

/**
 * Adapter for Gnani's speech APIs, written against docs.gnani.ai.
 *
 * Prisma's realtime socket authenticates with handshake headers, which browsers
 * cannot set, and it only emits final segments. So YAAR detects end of speech in
 * the browser and sends whole utterances to the REST endpoint: same final text,
 * far simpler to run, and it deploys on serverless. Timbre's SSE endpoint gives
 * us real streaming for the reply.
 */
const BASE = "https://api.vachana.ai";
export const TTS_SAMPLE_RATE = 24000;

export class GnaniError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function apiKey(): string {
  const key = process.env.GNANI_API_KEY;
  if (!key) throw new GnaniError("GNANI_API_KEY is not set", 500);
  return key;
}

/** The API allows one active request per key, so briefly wait out a 429. */
async function withRateLimitRetry(call: () => Promise<Response>, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await call();
    if (response.status !== 429 || attempt >= 6) return response;
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 200 + attempt * 250));
    signal?.throwIfAborted();
  }
}

async function errorFrom(response: Response): Promise<GnaniError> {
  const body = await response.text().catch(() => "");
  console.error(`[gnani] ${response.status}: ${body.slice(0, 300)}`);
  return new GnaniError(`Speech service returned ${response.status}`, response.status);
}

export interface Transcript {
  text: string;
  language?: string;
}

export async function transcribe(
  audio: Blob,
  options: { language: string; keyterms?: string[]; previousText?: string; signal?: AbortSignal },
): Promise<Transcript> {
  const form = new FormData();
  form.set("audio_file", audio, "speech.wav");
  form.set("model", "prisma-v3.0");
  form.set("language_code", options.language === "auto" ? "indic-auto" : options.language);
  // codemix keeps English words in Latin script inside Hindi, as people text.
  form.set("format", "codemix");
  if (options.keyterms?.length) form.set("keyterms", JSON.stringify(options.keyterms));
  if (options.previousText && options.previousText.length >= 12) form.set("previous_text", options.previousText);

  const response = await withRateLimitRetry(
    () =>
      fetch(`${BASE}/stt/v3`, {
        method: "POST",
        headers: { "X-API-Key-ID": apiKey() },
        body: form,
        signal: options.signal,
      }),
    options.signal,
  );
  if (!response.ok) throw await errorFrom(response);
  const data = await response.json();
  return { text: String(data.transcript ?? "").trim(), language: data.detected_language_code };
}

export async function synthesizeStream(
  input: { text: string; voice: string; language: string; speed: number },
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const response = await withRateLimitRetry(
    () =>
      fetch(`${BASE}/api/v1/tts/sse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key-ID": apiKey() },
        body: JSON.stringify({
          text: input.text,
          voice: input.voice,
          model: "timbre-v3.0",
          language: input.language,
          speed: input.speed,
          audio_config: {
            sample_rate: TTS_SAMPLE_RATE,
            num_channels: 1,
            sample_width: 2,
            encoding: "linear_pcm",
            container: "raw",
          },
        }),
        signal,
      }),
    signal,
  );
  if (!response.ok || !response.body) throw await errorFrom(response);

  const upstream = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim();
          const data = /^data:\s*(.+)$/m.exec(block)?.[1];
          if (event === "error") {
            console.error(`[gnani] tts stream error: ${data?.slice(0, 300)}`);
            controller.error(new GnaniError("Speech stream failed", 502));
            return;
          }
          if (event === "complete") {
            controller.close();
            return;
          }
          if (event === "chunk" && data) {
            const audio = JSON.parse(data).audio as string;
            if (audio) {
              controller.enqueue(new Uint8Array(Buffer.from(audio, "base64")));
              return;
            }
          }
          continue;
        }
        const { done, value } = await upstream.read();
        if (done) {
          controller.close();
          return;
        }
        buffer += value.replace(/\r\n/g, "\n");
      }
    },
    cancel() {
      return upstream.cancel();
    },
  });
}
