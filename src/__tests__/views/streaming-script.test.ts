/**
 * Smoke test for the inline browser script CHAT_STREAMING_SCRIPT.
 *
 * The script can't be unit-tested directly (it runs in the browser, not in
 * the Worker), so the pure SSE parser lives in src/views/client/sse-parser.ts
 * where it IS tested (src/__tests__/views/sse-parser.test.ts). This file's
 * job is to fail loudly if the inline script ever regresses to the broken
 * pre-buffering pattern that silently dropped frames straddling chunk
 * boundaries.
 *
 * Asserts the script (a) contains the buffer accumulator, (b) holds back the
 * trailing partial via `parts.pop()`, and (c) does NOT contain the old
 * per-chunk split-and-forget shape.
 */

import { describe, it, expect } from "vitest";
import { CHAT_STREAMING_SCRIPT } from "../../views/client/streaming";

describe("CHAT_STREAMING_SCRIPT — SSE buffering pattern", () => {
  it("declares an SSE buffer accumulator", () => {
    expect(CHAT_STREAMING_SCRIPT).toMatch(/var sseBuf\s*=\s*''/);
  });

  it("accumulates each decoded read into the buffer (`sseBuf += dec.decode(...)`)", () => {
    expect(CHAT_STREAMING_SCRIPT).toMatch(/sseBuf\s*\+=\s*dec\.decode/);
  });

  it("holds the trailing partial back via parts.pop()", () => {
    // The fix relies on `var parts = sseBuf.split(...); sseBuf = parts.pop()`
    // — the last fragment is potentially incomplete and must be retained
    // for the next read.
    expect(CHAT_STREAMING_SCRIPT).toMatch(/sseBuf\s*=\s*parts\.pop\(\)/);
  });

  it("does not call chunk.split(...).forEach directly on a per-read chunk", () => {
    // The broken pre-fix shape was: `chunk.split(/\\n\\n/).forEach(...)`.
    // If that regresses, frames straddling reader.read() boundaries get
    // silently dropped.
    expect(CHAT_STREAMING_SCRIPT).not.toMatch(/chunk\.split\(\/\\\\n\\\\n\/\)\.forEach/);
  });
});
