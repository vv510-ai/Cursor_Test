/** Default upstream model id — fixed per product spec (not a secret). */
export const DEEPSEEK_MODEL = "deepseek-chat";

export function getJwtSecret(): string {
  const s = process.env.JWT_SECRET?.trim();
  if (!s) {
    throw new Error("JWT_SECRET is required in environment (.env)");
  }
  return s;
}

export function jwtExpiresSeconds(): number {
  const raw = process.env.JWT_EXPIRES_IN ?? "604800";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 604800;
}

export function dailyChatLimit(): number {
  const raw = process.env.DAILY_CHAT_LIMIT ?? "200";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

export function rateLimitChatPerMinute(): number {
  const raw = process.env.RATE_LIMIT_CHAT_PER_MIN ?? "30";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/** Sum of message.content chars allowed toward upstream (approximate context budget). */
export function maxContextChars(): number {
  const raw = process.env.MAX_CONTEXT_CHARS ?? "120000";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 120000;
}
