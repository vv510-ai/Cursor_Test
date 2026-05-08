import { describe, expect, it } from "vitest";
import { buildChatCompletionPayload } from "../deepseekUpstream.js";
import { DEEPSEEK_MODEL } from "../config.js";

const msgs = [{ role: "user", content: "hi" }];

describe("buildChatCompletionPayload", () => {
  it("chat mode disables thinking", () => {
    const p = buildChatCompletionPayload(msgs, "chat") as {
      model: string;
      stream: boolean;
      thinking: { type: string };
      reasoning_effort?: string;
    };
    expect(p.model).toBe(DEEPSEEK_MODEL);
    expect(p.stream).toBe(true);
    expect(p.thinking).toEqual({ type: "disabled" });
    expect(p.reasoning_effort).toBeUndefined();
  });

  it("reasoner mode enables thinking + high effort", () => {
    const p = buildChatCompletionPayload(msgs, "reasoner") as {
      thinking: { type: string };
      reasoning_effort: string;
    };
    expect(p.thinking).toEqual({ type: "enabled" });
    expect(p.reasoning_effort).toBe("high");
  });

  it("forwards messages array as-is (history is already cleansed by caller)", () => {
    const history = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ];
    const p = buildChatCompletionPayload(history, "chat") as {
      messages: typeof history;
    };
    expect(p.messages).toEqual(history);
    expect(p.messages.every((m) => !("reasoning_content" in m))).toBe(true);
  });

  it("prepends system prompt when provided and no system message exists", () => {
    const p = buildChatCompletionPayload(msgs, "chat", {
      systemPrompt: "Be terse.",
    }) as { messages: { role: string; content: string }[] };
    expect(p.messages[0]).toEqual({ role: "system", content: "Be terse." });
    expect(p.messages[1]).toEqual(msgs[0]);
  });

  it("does not duplicate system message if caller already supplied one", () => {
    const history = [
      { role: "system", content: "existing system" },
      { role: "user", content: "hi" },
    ];
    const p = buildChatCompletionPayload(history, "chat", {
      systemPrompt: "would-be system",
    }) as { messages: typeof history };
    expect(p.messages).toEqual(history);
    expect(p.messages.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("ignores empty / whitespace system prompt", () => {
    const p = buildChatCompletionPayload(msgs, "chat", {
      systemPrompt: "   ",
    }) as { messages: typeof msgs };
    expect(p.messages).toEqual(msgs);
  });

  it("forwards valid temperature and max_tokens, drops invalid", () => {
    const p1 = buildChatCompletionPayload(msgs, "chat", {
      temperature: 0.7,
      maxTokens: 1024,
    }) as { temperature: number; max_tokens: number };
    expect(p1.temperature).toBe(0.7);
    expect(p1.max_tokens).toBe(1024);

    const p2 = buildChatCompletionPayload(msgs, "chat", {
      temperature: null,
      maxTokens: null,
    }) as { temperature?: number; max_tokens?: number };
    expect(p2.temperature).toBeUndefined();
    expect(p2.max_tokens).toBeUndefined();

    const p3 = buildChatCompletionPayload(msgs, "chat", {
      temperature: Number.NaN,
      maxTokens: 0,
    }) as { temperature?: number; max_tokens?: number };
    expect(p3.temperature).toBeUndefined();
    expect(p3.max_tokens).toBeUndefined();
  });

  it("floors fractional max_tokens to integer", () => {
    const p = buildChatCompletionPayload(msgs, "chat", {
      maxTokens: 1024.9,
    }) as { max_tokens: number };
    expect(p.max_tokens).toBe(1024);
  });
});
