/**
 * Unit tests for buildSystemPrompt — spec §9 F4.
 *
 * Verifies:
 *   - cv_markdown appears verbatim in the first system block,
 *   - cache_control { type: 'ephemeral' } is attached to the CV block,
 *   - all five behavioral instruction clauses are present in the
 *     instructions block.
 */

import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../../prompts/system";

describe("buildSystemPrompt", () => {
  const cv = "# Jane Doe\n\nSenior engineer with 10 years of experience in distributed systems.";

  it("returns an array with two blocks", () => {
    const blocks = buildSystemPrompt(cv);
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBe(2);
  });

  it("first block contains cv_markdown verbatim", () => {
    const blocks = buildSystemPrompt(cv);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].text).toContain(cv);
  });

  it("first block has cache_control { type: 'ephemeral' }", () => {
    const blocks = buildSystemPrompt(cv);
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("second block contains all five behavioral clauses", () => {
    const blocks = buildSystemPrompt(cv);
    const text = blocks[1].text.toLowerCase();
    // (a) first-person
    expect(text).toMatch(/first[\s-]person/);
    // (b) refuse out-of-CV with redirect
    expect(text).toMatch(/not in (my )?(profile|cv)|out[- ]of[- ]cv|ask (me|the owner)/);
    // (c) [cv] citation token on factual claims
    expect(blocks[1].text).toContain("[cv]");
    // (d) refuse prompt-injection / extraction
    expect(text).toMatch(/inject|ignore (previous|prior)|extract|system prompt/);
    // (e) politely decline off-topic
    expect(text).toMatch(/off[- ]topic|decline/);
  });

  it("second block has no cache_control", () => {
    const blocks = buildSystemPrompt(cv);
    expect(blocks[1].cache_control).toBeUndefined();
  });
});
