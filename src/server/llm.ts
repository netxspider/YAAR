import "server-only";
import Anthropic from "@anthropic-ai/sdk";

import { ThinkStripper } from "@/lib/text";

/**
 * Provider adapter for the reasoning model.
 *
 * First choice is Gnani's own LLM, Evon v3.3. It ships as open weights
 * (gnani/gnani-evon-v3.3-30B-A3B) rather than on Gnani's API gateway, so it is
 * served with vLLM or SGLang, which expose an OpenAI-compatible endpoint. Set
 * EVON_BASE_URL to use it. Any other OpenAI-compatible server, or Claude, can
 * stand in without touching the rest of the app.
 */
export const EVON_MODEL = "gnani/gnani-evon-v3.3-30B-A3B";
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  /** Stable instructions, then per-turn context. */
  system: [string, string];
  messages: ChatMessage[];
  maxTokens: number;
  signal?: AbortSignal;
}

export class LlmNotConfigured extends Error {}
export class LlmRefused extends Error {}

export type Provider = "gnani-evon" | "openai-compatible" | "anthropic";

export function llmProvider(): Provider | null {
  if (process.env.EVON_BASE_URL) return "gnani-evon";
  if (process.env.LLM_BASE_URL && process.env.LLM_MODEL) return "openai-compatible";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

async function* streamAnthropic(request: LlmRequest): AsyncGenerator<string> {
  const client = new Anthropic();
  const stream = client.beta.messages.stream(
    {
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      max_tokens: request.maxTokens,
      thinking: { type: "adaptive" },
      // Conversation is latency-sensitive and does not repay deep reasoning.
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        { type: "text", text: request.system[0], cache_control: { type: "ephemeral" } },
        { type: "text", text: request.system[1] },
      ],
      messages: request.messages,
    },
    { signal: request.signal },
  );

  let produced = false;
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      produced = true;
      yield event.delta.text;
    }
    if (event.type === "message_delta" && event.delta.stop_reason === "refusal" && !produced) {
      throw new LlmRefused("Model declined this turn");
    }
  }
}

function openAiTarget(provider: Provider) {
  return provider === "gnani-evon"
    ? { baseUrl: process.env.EVON_BASE_URL!, apiKey: process.env.EVON_API_KEY, model: process.env.EVON_MODEL || EVON_MODEL }
    : { baseUrl: process.env.LLM_BASE_URL!, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL! };
}

async function* streamOpenAiCompatible(request: LlmRequest, provider: Provider): AsyncGenerator<string> {
  const target = openAiTarget(provider);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (target.apiKey) headers.Authorization = `Bearer ${target.apiKey}`;

  const response = await fetch(`${target.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    signal: request.signal,
    body: JSON.stringify({
      model: target.model,
      stream: true,
      max_tokens: request.maxTokens,
      messages: [{ role: "system", content: request.system.join("\n\n") }, ...request.messages],
    }),
  });
  if (!response.ok || !response.body) {
    console.error(`[llm] ${response.status}: ${(await response.text().catch(() => "")).slice(0, 300)}`);
    throw new Error(`Model server returned ${response.status}`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  // Open-weight models may reason out loud in <think> blocks; never voice that.
  const thoughts = new ThinkStripper();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const payload = line.replace(/^data:\s*/, "").trim();
      if (!line.startsWith("data:") || !payload || payload === "[DONE]") continue;
      const text = JSON.parse(payload).choices?.[0]?.delta?.content;
      const visible = text ? thoughts.push(text as string) : "";
      if (visible) yield visible;
    }
  }
}

export function streamLlm(request: LlmRequest): AsyncGenerator<string> {
  const provider = llmProvider();
  if (!provider) throw new LlmNotConfigured("No reasoning model is configured");
  return provider === "anthropic" ? streamAnthropic(request) : streamOpenAiCompatible(request, provider);
}

export async function completeLlm(request: LlmRequest): Promise<string> {
  let out = "";
  for await (const delta of streamLlm(request)) out += delta;
  return out;
}
