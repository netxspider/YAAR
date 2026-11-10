import { rejectIfAbusive } from "@/server/guard";
import { completeLlm } from "@/server/llm";
import { MEMORY_SYSTEM } from "@/server/prompt";
import type { MemoryOps } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY: MemoryOps = { add: [], update: [], remove: [] };
const CATEGORIES = ["about", "people", "life", "preference"];

export async function POST(request: Request) {
  const rejected = rejectIfAbusive(request);
  if (rejected) return rejected;

  try {
    const { turns, memories } = await request.json();
    const existing = (memories as { id: string; text: string }[]).map((m) => `${m.id}: ${m.text}`).join("\n") || "(none)";
    const conversation = (turns as { role: string; text: string }[])
      .slice(-12)
      .map((turn) => `${turn.role === "user" ? "User" : "Companion"}: ${turn.text}`)
      .join("\n");

    const raw = await completeLlm({
      system: [MEMORY_SYSTEM, ""],
      messages: [{ role: "user", content: `EXISTING MEMORIES\n${existing}\n\nLATEST CONVERSATION\n${conversation}` }],
      maxTokens: 1500,
      signal: request.signal,
    });

    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as Partial<MemoryOps>;
    const known = new Set((memories as { id: string }[]).map((m) => m.id));

    const ops: MemoryOps = {
      add: (parsed.add ?? [])
        .filter((item) => CATEGORIES.includes(item.category) && item.text)
        .slice(0, 3)
        .map((item) => ({
          category: item.category,
          text: item.text,
          quote: item.quote || undefined,
          basis: item.basis === "inferred" ? "inferred" : "stated",
        })),
      update: (parsed.update ?? []).filter((item) => known.has(item.id) && item.text),
      remove: (parsed.remove ?? []).filter((id) => known.has(id)),
    };
    return Response.json(ops);
  } catch (error) {
    // Memory is best-effort and must never disturb the conversation.
    if (!request.signal.aborted) console.error("[memory]", error instanceof Error ? error.message : error);
    return Response.json(EMPTY);
  }
}
