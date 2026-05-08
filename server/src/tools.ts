/**
 * Built-in tool registry for OpenAI-compatible function calling.
 *
 * Tools are intentionally small, side-effect-free, and synchronous.
 * Adding a new tool: define name + schema + executor.
 */

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolDefinition = {
  name: string;
  schema: ToolSchema;
  execute: (argsJson: string) => Promise<string>;
};

const calculator: ToolDefinition = {
  name: "calculator",
  schema: {
    type: "function",
    function: {
      name: "calculator",
      description:
        "Evaluate a basic arithmetic expression. Supports + - * / parentheses and decimal numbers. Returns the result as a string.",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Arithmetic expression, e.g. \"(2+3)*4 / 1.5\"",
          },
        },
        required: ["expression"],
        additionalProperties: false,
      },
    },
  },
  async execute(argsJson) {
    let args: { expression?: unknown };
    try {
      args = JSON.parse(argsJson) as { expression?: unknown };
    } catch {
      return JSON.stringify({ error: "invalid JSON arguments" });
    }
    const expr = typeof args.expression === "string" ? args.expression : "";
    if (!expr) return JSON.stringify({ error: "missing 'expression'" });
    try {
      const result = evalArithmetic(expr);
      return JSON.stringify({ result });
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : "eval failed" });
    }
  },
};

const currentTime: ToolDefinition = {
  name: "current_time",
  schema: {
    type: "function",
    function: {
      name: "current_time",
      description: "Return the current server time. Use when asked for 'now', 'today', or any current time/date.",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description:
              "IANA timezone, e.g. 'Asia/Shanghai'. Defaults to UTC.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  async execute(argsJson) {
    let args: { timezone?: unknown };
    try {
      args = JSON.parse(argsJson) as { timezone?: unknown };
    } catch {
      args = {};
    }
    const tz = typeof args.timezone === "string" && args.timezone ? args.timezone : "UTC";
    try {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now);
      return JSON.stringify({ iso_utc: now.toISOString(), formatted, timezone: tz });
    } catch (e) {
      return JSON.stringify({
        error: e instanceof Error ? e.message : "invalid timezone",
      });
    }
  },
};

const REGISTRY = new Map<string, ToolDefinition>([
  [calculator.name, calculator],
  [currentTime.name, currentTime],
]);

export function listToolSchemas(): ToolSchema[] {
  return Array.from(REGISTRY.values()).map((t) => t.schema);
}

export function getTool(name: string): ToolDefinition | undefined {
  return REGISTRY.get(name);
}

/**
 * Safe arithmetic evaluator: only +, -, *, /, parentheses, decimals.
 * Refuses anything else. No `Function` / `eval` ever called.
 */
export function evalArithmetic(input: string): number {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  const value = parser.parseExpr();
  parser.expectEnd();
  if (!Number.isFinite(value)) throw new Error("non-finite result");
  return Number(value.toFixed(12));
}

type Token =
  | { kind: "num"; value: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" };

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "(") {
      out.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      out.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      out.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let j = i;
      let dot = ch === ".";
      while (j + 1 < s.length) {
        const c = s[j + 1]!;
        if (c >= "0" && c <= "9") j++;
        else if (c === "." && !dot) {
          dot = true;
          j++;
        } else break;
      }
      const numStr = s.slice(i, j + 1);
      const num = Number(numStr);
      if (!Number.isFinite(num)) throw new Error(`invalid number '${numStr}'`);
      out.push({ kind: "num", value: num });
      i = j + 1;
      continue;
    }
    throw new Error(`unexpected character '${ch}'`);
  }
  return out;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parseExpr(): number {
    let v = this.parseTerm();
    while (this.peek("+") || this.peek("-")) {
      const op = (this.tokens[this.pos] as { value: "+" | "-" }).value;
      this.pos++;
      const r = this.parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  private parseTerm(): number {
    let v = this.parseFactor();
    while (this.peek("*") || this.peek("/")) {
      const op = (this.tokens[this.pos] as { value: "*" | "/" }).value;
      this.pos++;
      const r = this.parseFactor();
      if (op === "*") v *= r;
      else {
        if (r === 0) throw new Error("division by zero");
        v /= r;
      }
    }
    return v;
  }

  private parseFactor(): number {
    const t = this.tokens[this.pos];
    if (!t) throw new Error("unexpected end of expression");
    if (t.kind === "op" && (t.value === "+" || t.value === "-")) {
      this.pos++;
      const v = this.parseFactor();
      return t.value === "-" ? -v : v;
    }
    if (t.kind === "num") {
      this.pos++;
      return t.value;
    }
    if (t.kind === "lparen") {
      this.pos++;
      const v = this.parseExpr();
      const close = this.tokens[this.pos];
      if (!close || close.kind !== "rparen") throw new Error("expected ')'");
      this.pos++;
      return v;
    }
    throw new Error("unexpected token");
  }

  private peek(op: "+" | "-" | "*" | "/"): boolean {
    const t = this.tokens[this.pos];
    return Boolean(t && t.kind === "op" && t.value === op);
  }

  expectEnd() {
    if (this.pos !== this.tokens.length) throw new Error("trailing input");
  }
}
