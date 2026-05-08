import type { ConversationMode } from "./db.js";
import { DEEPSEEK_MODEL } from "./config.js";
import type { ToolSchema } from "./tools.js";

export type UpstreamMessage = {
  role: string;
  content: string | null;
  // Set when the assistant calls one or more tools.
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  // Set when this is a tool-result message returned to the model.
  tool_call_id?: string;
  name?: string;
};

export type ChatOverrides = {
  systemPrompt?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  tools?: ToolSchema[];
};

/**
 * DeepSeek OpenAI-compatible Chat Completions body.
 * Always uses model `deepseek-chat`; toggles thinking via `thinking` + `reasoning_effort`.
 *
 * Per-conversation overrides:
 * - `systemPrompt` is prepended as a `system` message (only if no system message already exists).
 * - `temperature` / `maxTokens` are forwarded if numeric and non-null.
 */
export function buildChatCompletionPayload(
  messages: UpstreamMessage[],
  mode: ConversationMode,
  overrides: ChatOverrides = {},
): Record<string, unknown> {
  const finalMessages = applySystemPrompt(messages, overrides.systemPrompt);

  const base: Record<string, unknown> = {
    model: DEEPSEEK_MODEL,
    messages: finalMessages,
    stream: true,
  };

  if (mode === "reasoner") {
    base.reasoning_effort = "high";
    base.thinking = { type: "enabled" };
  } else {
    base.thinking = { type: "disabled" };
  }

  if (
    typeof overrides.temperature === "number" &&
    Number.isFinite(overrides.temperature)
  ) {
    base.temperature = overrides.temperature;
  }
  if (
    typeof overrides.maxTokens === "number" &&
    Number.isFinite(overrides.maxTokens) &&
    overrides.maxTokens > 0
  ) {
    base.max_tokens = Math.floor(overrides.maxTokens);
  }

  if (overrides.tools && overrides.tools.length > 0) {
    base.tools = overrides.tools;
    base.tool_choice = "auto";
  }

  return base;
}

function applySystemPrompt(
  messages: UpstreamMessage[],
  systemPrompt: string | null | undefined,
): UpstreamMessage[] {
  const trimmed = systemPrompt?.trim();
  if (!trimmed) return messages;
  if (messages.some((m) => m.role === "system")) return messages;
  return [{ role: "system", content: trimmed }, ...messages];
}
