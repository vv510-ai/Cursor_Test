/**
 * Incrementally parse OpenAI-style SSE lines and accumulate
 * `delta.content`, `delta.reasoning_content`, and `delta.tool_calls`
 * from chat completion chunks.
 */
export type ToolCallAcc = {
  id: string | null;
  name: string;
  argumentsJson: string;
};

export type SseAccum = {
  buf: string;
  decoder: TextDecoder;
  reasoning: string;
  content: string;
  toolCalls: Map<number, ToolCallAcc>;
  finishReason: string | null;
};

export function createSseAccum(): SseAccum {
  return {
    buf: "",
    decoder: new TextDecoder(),
    reasoning: "",
    content: "",
    toolCalls: new Map(),
    finishReason: null,
  };
}

type DeltaToolCall = {
  index?: number;
  id?: string | null;
  type?: string;
  function?: { name?: string; arguments?: string };
};

export type SseCallbacks = {
  onContentDelta?: (s: string) => void;
  onReasoningDelta?: (s: string) => void;
  onToolCallDelta?: (call: ToolCallAcc, index: number) => void;
  onFinish?: (reason: string) => void;
};

export function feedSseBinary(
  acc: SseAccum,
  chunk: Uint8Array,
  cb?: SseCallbacks,
): void {
  acc.buf += acc.decoder.decode(chunk, { stream: true });
  const parts = acc.buf.split("\n");
  acc.buf = parts.pop() ?? "";

  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") continue;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const root = json as {
      choices?: Array<{
        delta?: {
          content?: string | null;
          reasoning_content?: string | null;
          tool_calls?: DeltaToolCall[];
        };
        finish_reason?: string | null;
      }>;
    };
    const choice = root.choices?.[0];
    const delta = choice?.delta;

    if (typeof delta?.content === "string" && delta.content.length > 0) {
      acc.content += delta.content;
      cb?.onContentDelta?.(delta.content);
    }
    if (
      typeof delta?.reasoning_content === "string" &&
      delta.reasoning_content.length > 0
    ) {
      acc.reasoning += delta.reasoning_content;
      cb?.onReasoningDelta?.(delta.reasoning_content);
    }
    if (Array.isArray(delta?.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === "number" ? tc.index : 0;
        let cur = acc.toolCalls.get(idx);
        if (!cur) {
          cur = { id: null, name: "", argumentsJson: "" };
          acc.toolCalls.set(idx, cur);
        }
        if (typeof tc.id === "string" && tc.id.length > 0) cur.id = tc.id;
        if (typeof tc.function?.name === "string" && tc.function.name.length > 0) {
          cur.name += tc.function.name;
        }
        if (typeof tc.function?.arguments === "string") {
          cur.argumentsJson += tc.function.arguments;
        }
        cb?.onToolCallDelta?.(cur, idx);
      }
    }
    if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
      acc.finishReason = choice.finish_reason;
      cb?.onFinish?.(choice.finish_reason);
    }
  }
}

/**
 * Drain a ReadableStream of upstream SSE bytes, invoking callbacks per delta.
 * Returns the final accumulator state when the stream ends.
 */
export async function consumeUpstreamSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  cb?: SseCallbacks,
): Promise<SseAccum> {
  const acc = createSseAccum();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) feedSseBinary(acc, value, cb);
    }
  } finally {
    reader.releaseLock();
  }
  return acc;
}
