import { describe, expect, it } from "vitest";
import { evalArithmetic, getTool, listToolSchemas } from "../tools.js";

describe("evalArithmetic (safe arithmetic parser)", () => {
  it("evaluates basic ops with precedence", () => {
    expect(evalArithmetic("1 + 2 * 3")).toBe(7);
    expect(evalArithmetic("(1 + 2) * 3")).toBe(9);
    expect(evalArithmetic("10 / 4")).toBe(2.5);
    expect(evalArithmetic("-3 + 5")).toBe(2);
    expect(evalArithmetic("2 * -2")).toBe(-4);
    expect(evalArithmetic("(2+3)*4 / 1.25")).toBe(16);
  });

  it("rejects identifiers and dangerous chars (no eval/Function)", () => {
    expect(() => evalArithmetic("alert(1)")).toThrow();
    expect(() => evalArithmetic("process.exit()")).toThrow();
    expect(() => evalArithmetic("1 ** 2")).toThrow(); // unsupported
    expect(() => evalArithmetic("1; 2")).toThrow();
  });

  it("rejects division by zero", () => {
    expect(() => evalArithmetic("1 / 0")).toThrow(/division by zero/);
  });

  it("rejects unbalanced parens / trailing input", () => {
    expect(() => evalArithmetic("(1 + 2")).toThrow();
    expect(() => evalArithmetic("1 + 2)")).toThrow();
    expect(() => evalArithmetic("1 + 2 3")).toThrow();
  });
});

describe("tool registry", () => {
  it("exposes calculator + current_time as OpenAI-shape schemas", () => {
    const schemas = listToolSchemas();
    const names = schemas.map((s) => s.function.name).sort();
    expect(names).toEqual(["calculator", "current_time"]);
    for (const s of schemas) {
      expect(s.type).toBe("function");
      expect(typeof s.function.description).toBe("string");
      expect(s.function.parameters).toBeTypeOf("object");
    }
  });

  it("calculator.execute returns JSON {result} for valid input", async () => {
    const calc = getTool("calculator");
    expect(calc).toBeDefined();
    const out = await calc!.execute(JSON.stringify({ expression: "(1+2)*3" }));
    expect(JSON.parse(out)).toEqual({ result: 9 });
  });

  it("calculator.execute returns JSON {error} for invalid input", async () => {
    const calc = getTool("calculator")!;
    const out = await calc.execute(JSON.stringify({ expression: "alert(1)" }));
    const parsed = JSON.parse(out) as { error?: string; result?: number };
    expect(parsed.error).toBeTypeOf("string");
    expect(parsed.result).toBeUndefined();
  });

  it("calculator.execute handles malformed JSON gracefully", async () => {
    const calc = getTool("calculator")!;
    const out = await calc.execute("{not json");
    const parsed = JSON.parse(out) as { error?: string };
    expect(parsed.error).toMatch(/invalid JSON/i);
  });

  it("current_time.execute returns iso_utc and formatted", async () => {
    const ct = getTool("current_time")!;
    const out = await ct.execute(JSON.stringify({ timezone: "Asia/Shanghai" }));
    const parsed = JSON.parse(out) as {
      iso_utc?: string;
      formatted?: string;
      timezone?: string;
    };
    expect(parsed.iso_utc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.formatted).toBeTypeOf("string");
    expect(parsed.timezone).toBe("Asia/Shanghai");
  });

  it("current_time.execute defaults to UTC when timezone missing/invalid", async () => {
    const ct = getTool("current_time")!;
    const out = await ct.execute("{}");
    const parsed = JSON.parse(out) as { timezone?: string };
    expect(parsed.timezone).toBe("UTC");
  });
});
