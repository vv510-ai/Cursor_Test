/**
 * Lightweight content moderation.
 *
 * Two layers:
 * 1. Default keyword/regex blocklist — short and deliberately conservative,
 *    intended to catch obvious abuse vectors. Tune for your locale.
 * 2. Optional external moderation hook (env-gated). Plug in OpenAI moderation,
 *    Azure Content Safety, etc. by setting MODERATION_HOOK_URL.
 *
 * Both incoming user messages and (best-effort) outgoing assistant responses
 * pass through `moderate(text, "user" | "assistant")`.
 */

export type ModerationResult =
  | { ok: true }
  | { ok: false; reason: string; matched?: string };

const DEFAULT_PATTERNS: { id: string; re: RegExp; reason: string }[] = [
  // Prompt-injection markers that try to escape system instructions
  {
    id: "prompt-injection-ignore",
    re: /\b(ignore|disregard)\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|prompts)\b/i,
    reason: "Detected prompt-injection attempt (ignore previous instructions).",
  },
  // Crude self-harm pattern (intentionally narrow to avoid false positives)
  {
    id: "self-harm-explicit",
    re: /\b(how\s+to\s+)?(kill|hurt)\s+myself\b/i,
    reason: "Self-harm content blocked. If you're in distress, please contact a local hotline.",
  },
];

const ENV_PATTERNS: { id: string; re: RegExp; reason: string }[] = [];

(function loadEnvPatterns() {
  const raw = process.env.MODERATION_BLOCKLIST?.trim();
  if (!raw) return;
  // Comma-separated regex source strings, e.g. MODERATION_BLOCKLIST="\\bfoo\\b,\\bbar\\b"
  for (const src of raw.split(",")) {
    const trimmed = src.trim();
    if (!trimmed) continue;
    try {
      ENV_PATTERNS.push({
        id: `env-${ENV_PATTERNS.length}`,
        re: new RegExp(trimmed, "i"),
        reason: "Blocked by configured policy.",
      });
    } catch {
      // ignore invalid regex
    }
  }
})();

export function moderate(
  text: string,
  _direction: "user" | "assistant",
): ModerationResult {
  if (typeof text !== "string" || text.length === 0) return { ok: true };
  for (const p of DEFAULT_PATTERNS) {
    const m = text.match(p.re);
    if (m) return { ok: false, reason: p.reason, matched: m[0] };
  }
  for (const p of ENV_PATTERNS) {
    const m = text.match(p.re);
    if (m) return { ok: false, reason: p.reason, matched: m[0] };
  }
  return { ok: true };
}

/**
 * Optional external moderation hook. Returns `{ ok: true }` if hook is unset.
 * The hook should accept JSON `{ text, direction }` and return JSON
 * `{ flagged: boolean, reason?: string }` with HTTP 200.
 */
export async function externalModerate(
  text: string,
  direction: "user" | "assistant",
  signal?: AbortSignal,
): Promise<ModerationResult> {
  const url = process.env.MODERATION_HOOK_URL?.trim();
  if (!url) return { ok: true };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.MODERATION_HOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.MODERATION_HOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ text, direction }),
      signal,
    });
    if (!res.ok) return { ok: true }; // fail open: never block on infra issues
    const j = (await res.json()) as { flagged?: boolean; reason?: string };
    if (j.flagged) {
      return {
        ok: false,
        reason: j.reason ?? "Blocked by external moderation policy.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}
