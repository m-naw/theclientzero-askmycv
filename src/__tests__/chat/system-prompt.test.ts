/**
 * System-prompt integration tests for POST /chat — spec §9 F4.
 *
 * Verifies that the Anthropic API request constructed by the Worker contains
 * the correct system prompt content as observed via mock interceptor. All
 * five behavioral instruction criteria from the spec done_when checklist are
 * asserted here in addition to the CV-verbatim check.
 *
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import type { StoredConfig } from "../../types/config";

const ANTHROPIC_HOST = "https://anthropic-mock.test";

interface TestEnv {
  STATE: KVNamespace;
  ANTHROPIC_BASE_URL: string;
  ACCESS_JWKS_URL_OVERRIDE: string;
}

function getEnv(): TestEnv {
  return env as unknown as TestEnv;
}

async function clearKv(): Promise<void> {
  const kv = getEnv().STATE;
  const today = new Date().toISOString().slice(0, 10);
  for (const key of ["config", "setup_window_start", `spend:${today}`]) {
    await kv.delete(key);
  }
}

function baseConfig(): StoredConfig {
  return {
    display_name: "Alex Rivera",
    headline: "Staff Engineer",
    cv_markdown:
      "# Alex Rivera\n\nStaff engineer specializing in distributed systems. Led teams of 8–12 engineers across three product areas.",
    anthropic_api_key: "sk-ant-test",
    daily_budget_usd: 5,
    access_email: "owner@test",
    access_aud: "test-aud",
    access_team_domain: "test.cloudflareaccess.com",
    setup_timestamp: Date.now() - 1000,
  };
}

/** Minimal SSE body that satisfies the streaming bridge. */
function fakeAnthropicSse(): string {
  const events = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: { id: "m1", usage: { input_tokens: 10, output_tokens: 0 } },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Test reply." },
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 5 },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ];
  return events.join("");
}

interface CapturedRequest {
  body: unknown;
  count: number;
}

function mockAnthropicStream(captured: CapturedRequest): void {
  const pool = fetchMock.get(ANTHROPIC_HOST);
  pool
    .intercept({ path: /\/v1\/messages.*/, method: "POST" })
    .reply((opts: { body?: string }) => {
      captured.count += 1;
      try {
        captured.body = JSON.parse(opts.body ?? "{}");
      } catch {
        captured.body = opts.body;
      }
      return {
        statusCode: 200,
        data: fakeAnthropicSse(),
        responseOptions: { headers: { "content-type": "text/event-stream" } },
      };
    });
}

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function drainStream(res: Response): Promise<void> {
  const reader = res.body!.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

/** Extract flattened system prompt text from a captured Anthropic request body. */
function flatSystem(sent: { system?: Array<{ text: string }> | string }): string {
  if (!sent.system) return "";
  if (typeof sent.system === "string") return sent.system;
  return sent.system.map((b) => b.text).join("\n");
}

async function captureSystemPrompt(): Promise<string> {
  const captured: CapturedRequest = { body: null, count: 0 };
  mockAnthropicStream(captured);
  const req = new Request("https://example.test/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36",
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  });
  const res = await runFetch(req);
  expect(res.status).toBe(200);
  await drainStream(res);
  expect(captured.count).toBe(1);
  return flatSystem(captured.body as { system?: Array<{ text: string }> | string });
}

describe("POST /chat — system prompt content (spec §9 F4 done_when)", () => {
  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try {
      fetchMock.enableNetConnect(/localhost/);
    } catch {
      /* no-op */
    }
    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
    await getEnv().STATE.put("config", JSON.stringify(baseConfig()));
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("system field contains cv_markdown verbatim", async () => {
    const flat = await captureSystemPrompt();
    expect(flat).toContain(baseConfig().cv_markdown);
  });

  it("system field contains an instruction to reply in the first person", async () => {
    const flat = await captureSystemPrompt();
    expect(flat.toLowerCase()).toMatch(/first[\s-]person/);
  });

  it("system field contains instruction to refuse out-of-CV questions with owner-direct redirect", async () => {
    const flat = await captureSystemPrompt();
    expect(flat.toLowerCase()).toMatch(/not in (my )?(profile|cv)|out[- ]of[- ]cv|ask (me|the owner)/);
  });

  it("system field contains [cv] citation token instruction", async () => {
    const flat = await captureSystemPrompt();
    expect(flat).toContain("[cv]");
  });

  it("system field contains instruction to refuse prompt-injection and prompt-extraction", async () => {
    const flat = await captureSystemPrompt();
    expect(flat.toLowerCase()).toMatch(/inject|ignore (previous|prior)|extract|system prompt/);
  });

  it("system field contains instruction to politely decline off-topic requests", async () => {
    const flat = await captureSystemPrompt();
    expect(flat.toLowerCase()).toMatch(/off[- ]topic|decline/);
  });
});
