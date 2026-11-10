import { rejectIfAbusive } from "@/server/guard";
import { LlmNotConfigured, LlmRefused, streamLlm } from "@/server/llm";
import { contextPrompt, personaPrompt, toMessages } from "@/server/prompt";
import { ReadSplitter, detectCrisis } from "@/lib/text";
import type { ChatEvent, ChatRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRISIS_FALLBACK =
  "ये बात बहुत serious है, और तुम्हारी safety सबसे पहले है। क्या तुम अभी safe हो? किसी अपने को अभी पास बुला लो, और Tele-MANAS को 14416 पर call करो, free है और चौबीस घंटे खुला है। Emergency हो तो 112।";

export async function POST(request: Request) {
  const rejected = rejectIfAbusive(request);
  if (rejected) return rejected;

  let body: ChatRequest;
  try {
    body = await request.json();
    if (!body.profile?.companion?.name || !Array.isArray(body.turns)) throw new Error();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  body.turns = body.turns.slice(-24).map((turn) => ({ ...turn, text: String(turn.text).slice(0, 4000) }));
  body.memories = (body.memories ?? []).slice(0, 20);

  const lastUserLine = [...body.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
  const crisis = !body.opening && detectCrisis(lastUserLine);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      let spoke = false;
      try {
        if (crisis) send({ t: "crisis" });
        const splitter = new ReadSplitter();
        const deltas = streamLlm({
          system: [personaPrompt(body), contextPrompt(body, crisis)],
          messages: toMessages(body),
          maxTokens: 2000,
          signal: request.signal,
        });
        for await (const delta of deltas) {
          const { read, text } = splitter.push(delta);
          if (read) send({ t: "read", read });
          if (text) {
            spoke = true;
            send({ t: "delta", text });
          }
        }
        const rest = splitter.flush();
        if (rest) send({ t: "delta", text: rest });
        send({ t: "done" });
      } catch (error) {
        if (request.signal.aborted) {
          controller.close();
          return;
        }
        console.error("[chat]", error instanceof Error ? error.message : error);
        if (crisis && !spoke) {
          send({ t: "delta", text: CRISIS_FALLBACK });
          send({ t: "done" });
        } else if (error instanceof LlmNotConfigured) {
          send({ t: "error", message: "not_configured" });
        } else if (error instanceof LlmRefused) {
          send({ t: "error", message: "refused" });
        } else {
          send({ t: "error", message: "failed" });
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
