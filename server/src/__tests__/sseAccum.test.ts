import { describe, expect, it } from "vitest";
import { createSseAccum, feedSseBinary } from "../sseAccum.js";

const enc = new TextEncoder();

function feed(acc: ReturnType<typeof createSseAccum>, s: string) {
  feedSseBinary(acc, enc.encode(s));
}

describe("sseAccum", () => {
  it("accumulates content deltas across split frames", () => {
    const acc = createSseAccum();
    feed(acc, 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n');
    feed(acc, 'data: {"choices":[{"delta":{"content":"lo"}}]}\n');
    expect(acc.content).toBe("Hello");
    expect(acc.reasoning).toBe("");
  });

  it("separates reasoning_content from content", () => {
    const acc = createSseAccum();
    feed(
      acc,
      'data: {"choices":[{"delta":{"reasoning_content":"think 1 "}}]}\n' +
        'data: {"choices":[{"delta":{"reasoning_content":"think 2"}}]}\n' +
        'data: {"choices":[{"delta":{"content":"answer"}}]}\n',
    );
    expect(acc.reasoning).toBe("think 1 think 2");
    expect(acc.content).toBe("answer");
  });

  it("handles partial trailing line that arrives in next chunk", () => {
    const acc = createSseAccum();
    feed(acc, 'data: {"choices":[{"delta":{"content":"AB');
    expect(acc.content).toBe("");
    feed(acc, 'C"}}]}\n');
    expect(acc.content).toBe("ABC");
  });

  it("ignores [DONE] sentinel and bad json", () => {
    const acc = createSseAccum();
    feed(
      acc,
      'data: [DONE]\n' +
        'data: not-json\n' +
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n',
    );
    expect(acc.content).toBe("ok");
  });
});
