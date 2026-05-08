import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../password.js";

describe("password", () => {
  it("hash + verify roundtrip succeeds", () => {
    const h = hashPassword("hunter22-correct-horse");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("hunter22-correct-horse", h)).toBe(true);
  });

  it("verify fails on wrong password", () => {
    const h = hashPassword("first-password");
    expect(verifyPassword("second-password", h)).toBe(false);
  });

  it("verify rejects malformed stored hashes", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
    expect(verifyPassword("x", "scrypt$only-two")).toBe(false);
  });

  it("two hashes of the same password differ (salt)", () => {
    const a = hashPassword("same");
    const b = hashPassword("same");
    expect(a).not.toBe(b);
    expect(verifyPassword("same", a)).toBe(true);
    expect(verifyPassword("same", b)).toBe(true);
  });
});
