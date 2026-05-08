import { describe, expect, it } from "vitest";
import { sanitizeFtsQuery } from "../db.js";

describe("sanitizeFtsQuery", () => {
  it("returns empty string for blank input", () => {
    expect(sanitizeFtsQuery("")).toBe("");
    expect(sanitizeFtsQuery("   \t  ")).toBe("");
  });

  it("quotes each token to defeat FTS5 operators", () => {
    expect(sanitizeFtsQuery("hello world")).toBe('"hello" "world"');
  });

  it("strips quotes/control chars and never emits raw operators", () => {
    const out = sanitizeFtsQuery('foo OR bar "baz" NEAR(qux)');
    // tokens become quoted literals — none are interpreted as FTS operators
    expect(out).not.toMatch(/\bOR\b(?!")/); // OR appears, but only inside quotes
    expect(out.startsWith('"')).toBe(true);
    expect(out).toContain('"foo"');
    expect(out).toContain('"OR"');
    expect(out).toContain('"NEAR(qux)"');
    // No stray double-quotes left over
    expect(out.split('"').length % 2).toBe(1);
  });

  it("caps tokens at 16 to bound query size", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`).join(" ");
    const out = sanitizeFtsQuery(many);
    const tokenCount = (out.match(/"/g) ?? []).length / 2;
    expect(tokenCount).toBe(16);
  });

  it("handles CJK tokens", () => {
    expect(sanitizeFtsQuery("机器 学习")).toBe('"机器" "学习"');
  });
});
