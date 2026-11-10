import { llmProvider } from "@/server/llm";

export const dynamic = "force-dynamic";

export function GET() {
  const provider = llmProvider();
  return Response.json({ speech: Boolean(process.env.GNANI_API_KEY), brain: provider !== null, provider });
}
