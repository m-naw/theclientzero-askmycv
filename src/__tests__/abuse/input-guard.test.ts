/**
 * Unit tests for src/abuse/input-guard.ts — garbage input detection.
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare).
 */

import { describe, it, expect } from "vitest";
import { isGarbageInput } from "../../abuse/input-guard";

describe("isGarbageInput", () => {
  it("returns false for short text regardless of case", () => {
    // <= 100 chars: never garbage
    expect(isGarbageInput("A".repeat(100))).toBe(false);
    expect(isGarbageInput("HELLO WORLD")).toBe(false);
  });

  it("returns false for text longer than 100 chars with low uppercase fraction", () => {
    const text = "a".repeat(101);
    expect(isGarbageInput(text)).toBe(false);
  });

  it("returns false for text longer than 100 chars with mixed case below 70%", () => {
    // 69 uppercase + 31 lowercase = 69% uppercase
    const text = "A".repeat(69) + "a".repeat(32); // 101 chars
    expect(isGarbageInput(text)).toBe(false);
  });

  it("returns true for text longer than 100 chars with exactly 70% uppercase (boundary)", () => {
    // 71 uppercase + 29 lowercase = 71% > 70%, 100 total letters, 101 chars
    const text = "A".repeat(71) + "a".repeat(29) + "!"; // 101 chars
    expect(isGarbageInput(text)).toBe(true);
  });

  it("returns true for all-uppercase text longer than 100 chars", () => {
    expect(isGarbageInput("A".repeat(110))).toBe(true);
  });

  it("returns false for normal long text", () => {
    const text =
      "This is a normal question about the candidate's experience in software engineering and distributed systems. Tell me more about your background.";
    expect(isGarbageInput(text)).toBe(false);
  });

  it("returns false for text with no letters (only digits/punctuation) regardless of length", () => {
    // No letters means fraction calculation is undefined; should not throw or incorrectly flag
    const text = "1234567890!@#$%^&*()".repeat(6); // > 100 chars, no letters
    expect(isGarbageInput(text)).toBe(false);
  });
});
