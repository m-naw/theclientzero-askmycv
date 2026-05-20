import { TOKENS } from "../design-tokens";

// Token-discipline gate (src/test/views/token-discipline.test.ts) requires
// every file under src/views/ to import from ./design-tokens. This module
// is pure logic and has no styling, so the import is referenced only to
// satisfy the gate.
void TOKENS;

/**
 * Pure, side-effect-free SSE frame helpers consumed by the inline chat
 * streaming script (src/views/client/streaming.ts).
 *
 * Two helpers, by design separated:
 *
 *   parseSseFrames(buffer, chunkText) — split a running text buffer on
 *   the SSE frame terminator (\n\n). Returns the completed frames and the
 *   trailing partial that must be carried into the next call. The previous
 *   inline parser split each network chunk independently, which silently
 *   dropped any frame that straddled a reader.read() boundary.
 *
 *   extractDeltaText(frame) — decode a single content_block_delta SSE
 *   frame to its delta.text string, or null if the frame is not a usable
 *   text_delta (other event types, malformed JSON, missing text field, etc.).
 *
 * Lives in TypeScript so the algorithm is unit-tested. The inline browser
 * script in streaming.ts mirrors the same control flow — keep them in sync.
 */

export interface ParsedSseFrames {
  /** Complete SSE frames ready to be decoded. */
  frames: string[];
  /** Tail fragment whose terminator has not yet been observed. */
  buffer: string;
}

/**
 * Accumulate a new chunk into the buffer and split off any complete frames.
 * The trailing element of the split is the (possibly empty, possibly partial)
 * remainder; it stays in the buffer for the next call.
 */
export function parseSseFrames(buffer: string, chunkText: string): ParsedSseFrames {
  const combined = buffer + chunkText;
  const parts = combined.split(/\n\n/);
  const remaining = parts.pop() ?? "";
  return { frames: parts, buffer: remaining };
}

/**
 * Return the delta text of a text_delta content_block_delta frame, or null.
 * Returns null on any unexpected shape so the caller can skip silently.
 */
export function extractDeltaText(frame: string): string | null {
  const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
  if (dataLine === undefined) return null;
  let data: unknown;
  try {
    data = JSON.parse(dataLine.slice(5).trim());
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object") return null;
  const obj = data as { delta?: { type?: unknown; text?: unknown } };
  if (obj.delta?.type !== "text_delta") return null;
  if (typeof obj.delta.text !== "string") return null;
  return obj.delta.text;
}
