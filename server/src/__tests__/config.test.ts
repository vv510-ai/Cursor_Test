import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dailyChatLimit,
  getJwtSecret,
  jwtExpiresSeconds,
  maxContextChars,
  rateLimitChatPerMinute,
} from "../config.js";

const KEYS = [
  "JWT_SECRET",
  "JWT_EXPIRES_IN",
  "DAILY_CHAT_LIMIT",
  "RATE_LIMIT_CHAT_PER_MIN",
  "MAX_CONTEXT_CHARS",
] as const;

describe("config helpers", () => {
  const original: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of KEYS) original[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("getJwtSecret throws when missing", () => {
    delete process.env.JWT_SECRET;
    expect(() => getJwtSecret()).toThrow();
  });

  it("getJwtSecret returns trimmed value", () => {
    process.env.JWT_SECRET = "  abc  ";
    expect(getJwtSecret()).toBe("abc");
  });

  it("numeric helpers fall back to defaults on bad values", () => {
    process.env.JWT_EXPIRES_IN = "not-a-number";
    process.env.DAILY_CHAT_LIMIT = "-5";
    process.env.RATE_LIMIT_CHAT_PER_MIN = "0";
    process.env.MAX_CONTEXT_CHARS = "abc";
    expect(jwtExpiresSeconds()).toBe(604800);
    expect(dailyChatLimit()).toBe(200);
    expect(rateLimitChatPerMinute()).toBe(30);
    expect(maxContextChars()).toBe(120000);
  });

  it("numeric helpers honor positive overrides", () => {
    process.env.DAILY_CHAT_LIMIT = "10";
    process.env.RATE_LIMIT_CHAT_PER_MIN = "3";
    expect(dailyChatLimit()).toBe(10);
    expect(rateLimitChatPerMinute()).toBe(3);
  });
});
