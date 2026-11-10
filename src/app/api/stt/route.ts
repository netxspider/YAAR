import { GnaniError, transcribe } from "@/server/gnani";
import { rejectIfAbusive } from "@/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const rejected = rejectIfAbusive(request);
  if (rejected) return rejected;

  try {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0 || audio.size > MAX_BYTES) {
      return Response.json({ error: "Invalid audio" }, { status: 400 });
    }
    const keyterms = String(form.get("keyterms") ?? "")
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 50);

    const result = await transcribe(audio, {
      language: String(form.get("language") ?? "auto"),
      keyterms,
      previousText: String(form.get("previousText") ?? ""),
      signal: request.signal,
    });
    return Response.json(result);
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[stt]", error instanceof Error ? error.message : error);
    const status = error instanceof GnaniError ? error.status : 500;
    return Response.json({ error: "Could not transcribe" }, { status: status >= 400 ? status : 500 });
  }
}
