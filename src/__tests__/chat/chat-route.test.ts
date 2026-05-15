/**
 * Chat route tests — POST /chat — spec §9 F4 and §12 Test 6.
 *
 * Tests the full request path through worker.fetch under miniflare. The
 * upstream Anthropic call is intercepted by fetchMock; we capture the
 * request body to assert messages truncation, max_tokens, and system
 * prompt content, then reply with a synthetic SSE stream so the route
 * exercises its streaming-bridge code path.
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
    display_name: "Jane Doe",
    headline: "Engineer",
    cv_markdown:
      "# Jane Doe\n\nSenior backend engineer with experience across distributed systems and developer tooling.",
    anthropic_api_key: "sk-ant-test",
    daily_budget_usd: 5,
    access_email: "owner@test",
    access_aud: "test-aud",
    access_team_domain: "test.cloudflareaccess.com",
    setup_timestamp: Date.now() - 1000,
  };
}

/** Build an SSE body simulating Anthropic's stream events. */
function fakeAnthropicSse(): string {
  const events = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: { id: "m1", usage: { input_tokens: 10, output_tokens: 0 } },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: " there" },
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 25 },
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

function chatRequest(body: unknown): Request {
  return new Request("https://example.test/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function drainStream(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  out += dec.decode();
  return out;
}

describe("POST /chat", () => {
  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try { fetchMock.enableNetConnect(/localhost/); } catch { /* */ }
    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
    await getEnv().STATE.put("config", JSON.stringify(baseConfig()));
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("returns 400 when body is missing messages", async () => {
    const res = await runFetch(chatRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when messages is empty", async () => {
    const res = await runFetch(chatRequest({ messages: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when messages is not an array", async () => {
    const res = await runFetch(chatRequest({ messages: "hi" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid JSON body", async () => {
    const res = await runFetch(chatRequest("not-json{"));
    expect(res.status).toBe(400);
  });

  it("caps messages at last 12 when 13 are sent", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);

    const msgs = Array.from({ length: 13 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    }));
    const res = await runFetch(chatRequest({ messages: msgs }));
    expect(res.status).toBe(200);
    await drainStream(res);

    const sent = captured.body as { messages: unknown[]; max_tokens: number };
    expect(sent.messages.length).toBe(12);
    // oldest dropped — first remaining must be msg 1, not msg 0
    expect((sent.messages[0] as { content: string }).content).toBe("msg 1");
  });

  it("truncates each message content to 1500 characters", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);

    const longMsg = "a".repeat(2000);
    const res = await runFetch(chatRequest({ messages: [{ role: "user", content: longMsg }] }));
    expect(res.status).toBe(200);
    await drainStream(res);

    const sent = captured.body as { messages: { content: string }[] };
    expect(sent.messages[0].content.length).toBe(1500);
  });

  it("passes max_tokens=512 to Anthropic", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);
    const res = await runFetch(chatRequest({ messages: [{ role: "user", content: "Hi" }] }));
    expect(res.status).toBe(200);
    await drainStream(res);
    const sent = captured.body as { max_tokens: number };
    expect(sent.max_tokens).toBe(512);
  });

  it("system prompt sent to Anthropic contains cv_markdown verbatim", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);
    const res = await runFetch(chatRequest({ messages: [{ role: "user", content: "Hi" }] }));
    expect(res.status).toBe(200);
    await drainStream(res);
    const sent = captured.body as { system: Array<{ text: string }> | string };
    const cv = baseConfig().cv_markdown;
    if (typeof sent.system === "string") {
      expect(sent.system).toContain(cv);
    } else {
      const flat = sent.system.map((b) => b.text).join("\n");
      expect(flat).toContain(cv);
    }
  });

  it("returns 200 with content-type text/event-stream and emits SSE data chunks", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);

    const res = await runFetch(chatRequest({ messages: [{ role: "user", content: "Hi" }] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");

    const body = await drainStream(res);
    expect(body).toMatch(/^data: /m);
    // each event is delimited by a blank line
    expect(body).toContain("\n\n");
  });

  it("writes spend:<YYYY-MM-DD> to KV after successful stream", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);

    const res = await runFetch(chatRequest({ messages: [{ role: "user", content: "Hi" }] }));
    expect(res.status).toBe(200);
    await drainStream(res);

    const today = new Date().toISOString().slice(0, 10);
    const spend = await getEnv().STATE.get(`spend:${today}`);
    expect(spend).not.toBeNull();
    expect(Number(spend)).toBeGreaterThan(0);
  });
});
