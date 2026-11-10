import { GnaniError, TTS_SAMPLE_RATE, synthesizeStream } from "@/server/gnani";
import { rejectIfAbusive } from "@/server/guard";
import { cleanForSpeech, ttsLanguage } from "@/lib/text";
import { isVoice } from "@/lib/persona";
import type { LanguagePref } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectIfAbusive(request);
  if (rejected) return rejected;

  try {
    const body = await request.json();
    const text = cleanForSpeech(String(body.text ?? "")).slice(0, 1500);
    const voice = String(body.voice ?? "");
    if (!text || !isVoice(voice)) return Response.json({ error: "Bad request" }, { status: 400 });

    const pref = String(body.language ?? "auto") as LanguagePref;
    const speed = Math.min(1.15, Math.max(0.85, Number(body.speed) || 1));
    const audio = await synthesizeStream({ text, voice, speed, language: ttsLanguage(text, pref) }, request.signal);

    return new Response(audio, {
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Sample-Rate": String(TTS_SAMPLE_RATE),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[tts]", error instanceof Error ? error.message : error);
    const status = error instanceof GnaniError ? error.status : 500;
    return Response.json({ error: "Could not speak" }, { status: status >= 400 ? status : 500 });
  }
}
