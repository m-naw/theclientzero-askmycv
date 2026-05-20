/**
 * Tests for the pure SSE frame parser.
 *
 * Regression: the previous inline parser in CHAT_STREAMING_SCRIPT did not
 * buffer across `reader.read()` boundaries. When an Anthropic
 * `content_block_delta` frame straddled a network chunk boundary, both
 * halves failed `JSON.parse()` and were silently eaten by an empty catch,
 * dropping that delta's text from the rendered assistant reply.
 *
 * The pure helpers in sse-parser.ts (a) accumulate a buffer across calls
 * and only emit complete frames, and (b) decode a single frame to its
 * delta text. The streaming script wires them into reader.read().
 */

import { describe, it, expect } from "vitest";
import { parseSseFrames, extractDeltaText } from "../../views/client/sse-parser";

describe("parseSseFrames — buffering across chunk boundaries", () => {
  it("returns no frames and buffers the partial when chunk has no terminator", () => {
    const out = parseSseFrames("", "event: content_block_delta\ndata: {\"type\":\"co");
    expect(out.frames).toEqual([]);
    expect(out.buffer).toBe("event: content_block_delta\ndata: {\"type\":\"co");
  });

  it("emits the completed frame when the second chunk closes it", () => {
    const first = parseSseFrames(
      "",
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"',
    );
    expect(first.frames).toEqual([]);

    const second = parseSseFrames(first.buffer, "}}\n\n");
    expect(second.frames).toHaveLength(1);
    expect(second.buffer).toBe("");
    expect(extractDeltaText(second.frames[0])).toBe("hello");
  });

  it("emits multiple frames present in a single chunk and holds back the partial tail", () => {
    const completeA =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"A"}}\n\n';
    const completeB =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"B"}}\n\n';
    const partial = "event: content_block_delta\ndata: {\"type\":\"co";

    const out = parseSseFrames("", completeA + completeB + partial);
    expect(out.frames).toHaveLength(2);
    expect(out.buffer).toBe(partial);
    expect(extractDeltaText(out.frames[0])).toBe("A");
    expect(extractDeltaText(out.frames[1])).toBe("B");
  });

  it("reconstructs the three-chunk scenario from the bug report (middle frame straddles)", () => {
    // Three Anthropic content_block_delta frames, but the network slices them
    // so frame #2 straddles two reads. Frames #1 and #3 are visible; the old
    // parser dropped frame #2 silently. The new parser must emit all three.
    const f1 =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":", and backend systems in a highly regulated fintech environment. [cv]\\n\\nI hold an"}}\n\n';
    const f2 =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" MSc in Computer Science from the Technical University of Wroclaw. [cv]\\n\\nRight now I\'ve left Trans"}}\n\n';
    const f3 =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ferGo and I\'m building something of my own called Strategos, an"}}\n\n';

    // Slice f2 across two reads: first chunk = f1 + first half of f2; second chunk = second half of f2 + f3.
    const f2Mid = Math.floor(f2.length / 2);
    const chunkA = f1 + f2.slice(0, f2Mid);
    const chunkB = f2.slice(f2Mid) + f3;

    const out1 = parseSseFrames("", chunkA);
    const out2 = parseSseFrames(out1.buffer, chunkB);

    const texts = [...out1.frames, ...out2.frames]
      .map(extractDeltaText)
      .filter((t): t is string => t !== null);

    expect(texts).toHaveLength(3);
    expect(texts[0]).toContain("backend systems");
    expect(texts[1]).toContain("MSc in Computer Science");
    expect(texts[2]).toContain("Strategos");
  });

  it("does not include the trailing empty fragment as a frame when chunk ends with \\n\\n", () => {
    const complete =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"x"}}\n\n';
    const out = parseSseFrames("", complete);
    expect(out.frames).toHaveLength(1);
    expect(out.buffer).toBe("");
  });
});

describe("extractDeltaText — single-frame decoding", () => {
  it("returns delta.text for a text_delta frame", () => {
    const frame =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello world"}}';
    expect(extractDeltaText(frame)).toBe("hello world");
  });

  it("returns null for a frame whose JSON is not a text_delta", () => {
    const frame =
      'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","usage":{"input_tokens":5}}}';
    expect(extractDeltaText(frame)).toBeNull();
  });

  it("returns null for a frame with no data: line", () => {
    expect(extractDeltaText("event: ping\n")).toBeNull();
  });

  it("returns null for a frame whose data: payload is invalid JSON", () => {
    expect(extractDeltaText("event: x\ndata: {not json")).toBeNull();
  });

  it("returns null when delta.text is missing or not a string", () => {
    const frame =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta"}}';
    expect(extractDeltaText(frame)).toBeNull();
  });

  it("tolerates leading whitespace after data: (e.g. `data:  {...}`)", () => {
    const frame =
      'event: content_block_delta\ndata:  {"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}';
    expect(extractDeltaText(frame)).toBe("x");
  });
});
