/**
 * Prompt-cache observability: chat completion must emit a single structured
 * `chat_completion` log line containing both `cache_read_input_tokens` and
 * `cache_creation_input_tokens` parsed from the upstream usage block, so the
 * operator can verify in `wrangler tail` whether the existing CV cache
 * marker (src/prompts/system.ts) is actually firing.
 *
 * Follows the structural pattern of
 * src/__tests__/resilience/anthropic-timeout.test.ts:
 *   - fetchMock + ANTHROPIC_BASE_URL redirect
 *   - vi.spyOn(console, "log") to capture the structured log line
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import type { StoredConfig } from "../../types/config";

const ANTHROPIC_HOST = "https://anthropic-mock-cacheobs.test";
const API_KEY = "sk-ant-cache-obs-test-key-12345";

function getEnv(): { STATE: KVNamespace; ANTHROPIC_BASE_URL: string } {
  return env as never;
}

function baseConfig(): StoredConfig {
  return {
    display_name: "Test Owner",
    headline: "Engineer",
    cv_markdown: "# Test Owner\n\nBackend engineer.",
    anthropic_api_key: API_KEY,
    daily_budget_usd: 50,
    setup_timestamp: Date.now() - 1000,
    model: "claude-haiku-4-5-20251001",
  };
}

async function clearKv(): Promise<void> {
  const kv = getEnv().STATE;
  const today = new Date().toISOString().slice(0, 10);
  for (const key of ["config", "setup_window_start", `spend:${today}`]) {
    await kv.delete(key);
  }
}

function chatRequest(content = "Hello"): Request {
  return new Request("https://example.test/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36",
    },
    body: JSON.stringify({ messages: [{ role: "user", content }] }),
  });
}

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  // Drain the SSE body so the TransformStream flush() callback runs.
  if (res.body !== null) {
    await res.text();
  }
  await waitOnExecutionContext(ctx);
  return res;
}

function fakeAnthropicSse(opts: {
  inputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  outputTokens: number;
}): string {
  const events = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: "m1",
        usage: {
          input_tokens: opts.inputTokens,
          cache_read_input_tokens: opts.cacheRead,
          cache_creation_input_tokens: opts.cacheCreation,
          output_tokens: 0,
        },
      },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hi" },
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: opts.outputTokens },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ];
  return events.join("");
}

describe("prompt-cache observability", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ANTHROPIC_TIMEOUT_MS = "30000";
    await clearKv();
    await getEnv().STATE.put("config", JSON.stringify(baseConfig()));
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
    consoleLogSpy.mockRestore();
  });

  it("emits a chat_completion log with cache_read and cache_creation token counts", async () => {
    const pool = fetchMock.get(ANTHROPIC_HOST);
    pool
      .intercept({ path: /\/v1\/messages.*/, method: "POST" })
      .reply(
        200,
        fakeAnthropicSse({
          inputTokens: 1500,
          cacheRead: 1200,
          cacheCreation: 300,
          outputTokens: 42,
        }),
        { headers: { "content-type": "text/event-stream" } },
      );

    const res = await runFetch(chatRequest());
    expect(res.status).toBe(200);

    const logLines = consoleLogSpy.mock.calls.map((c) => String(c[0]));
    const completionLog = logLines.find((line) => line.includes('"event":"chat_completion"'));
    expect(completionLog, `expected chat_completion log, got: ${logLines.join(" | ")}`).toBeDefined();

    const parsed = JSON.parse(completionLog!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      event: "chat_completion",
      model: "claude-haiku-4-5-20251001",
      input_tokens: 1500,
      cache_read_input_tokens: 1200,
      cache_creation_input_tokens: 300,
      output_tokens: 42,
    });
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("emits zero cache_creation and cache_read when upstream omits them (defensive default)", async () => {
    const pool = fetchMock.get(ANTHROPIC_HOST);
    // Use the harness-style minimal SSE without cache fields to assert the parser
    // defaults to 0 rather than NaN/undefined when the upstream omits them.
    const minimalSse = [
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: { id: "m2", usage: { input_tokens: 10, output_tokens: 0 } },
      })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 5 },
      })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ].join("");

    pool
      .intercept({ path: /\/v1\/messages.*/, method: "POST" })
      .reply(200, minimalSse, { headers: { "content-type": "text/event-stream" } });

    const res = await runFetch(chatRequest());
    expect(res.status).toBe(200);

    const logLines = consoleLogSpy.mock.calls.map((c) => String(c[0]));
    const completionLog = logLines.find((line) => line.includes('"event":"chat_completion"'));
    expect(completionLog).toBeDefined();
    const parsed = JSON.parse(completionLog!) as Record<string, unknown>;
    expect(parsed.cache_read_input_tokens).toBe(0);
    expect(parsed.cache_creation_input_tokens).toBe(0);
  });
});
