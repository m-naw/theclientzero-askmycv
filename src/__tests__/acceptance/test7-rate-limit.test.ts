/**
 * Acceptance Test 7 — spec §12 Test 7:
 * "Per-IP rate limiting: 31st request within hour returns 429"
 *
 * Fixtures: config present with max_msgs_per_hour=30.
 * Anthropic mock is set up but should receive at most 30 calls.
 *
 * Steps validated:
 * 1. Send 30 requests from same IP — all succeed (200).
 * 2. Send 31st request from same IP — returns 429.
 * 3. Anthropic mock call count <= 30.
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
}

function getEnv(): TestEnv {
  return env as unknown as TestEnv;
}

async function clearKv(): Promise<void> {
  const kv = getEnv().STATE;
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getUTCHours().toString().padStart(2, "0");
  const ip = "10.0.0.1";
  for (const key of [
    "config",
    "setup_window_start",
    `spend:${today}`,
    `ratelimit:${ip}:${today}-${hour}`,
  ]) {
    await kv.delete(key);
  }
}

function fixtureConfig(): StoredConfig {
  return {
    display_name: "Rate Test User",
    headline: "Test Engineer",
    cv_markdown:
      "# Rate Test User\n\nSoftware engineer with 5 years of experience in web development and cloud infrastructure.",
    anthropic_api_key: "sk-ant-test",
    daily_budget_usd: 100,
    access_email: "owner@test",
    access_aud: "test-aud",
    access_team_domain: "test.cloudflareaccess.com",
    setup_timestamp: Date.now() - 2000,
    max_msgs_per_hour: 30,
  };
}

function fakeAnthropicSse(): string {
  return [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: { id: "msg_t7", usage: { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 0 } },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 5 },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ].join("");
}

interface CapturedRequest {
  count: number;
}

function mockAnthropicStream(captured: CapturedRequest): void {
  const pool = fetchMock.get(ANTHROPIC_HOST);
  pool
    .intercept({ path: /\/v1\/messages.*/, method: "POST" })
    .reply((_opts: { body?: string }) => {
      captured.count += 1;
      return {
        statusCode: 200,
        data: fakeAnthropicSse(),
        responseOptions: { headers: { "content-type": "text/event-stream" } },
      };
    })
    .times(100); // Allow many intercepts
}

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function drainStream(res: Response): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

function chatRequest(ip: string): Request {
  return new Request("https://example.test/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  });
}

describe("Acceptance Test 7 — per-IP rate limiting (spec §12)", () => {
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
    await getEnv().STATE.put("config", JSON.stringify(fixtureConfig()));
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("31st request within the same hour from same IP returns 429; Anthropic receives <= 30 calls", async () => {
    const captured: CapturedRequest = { count: 0 };
    mockAnthropicStream(captured);

    const ip = "10.0.0.1";
    const limit = 30;

    // Send 30 requests — all should be allowed
    for (let i = 0; i < limit; i++) {
      const res = await runFetch(chatRequest(ip));
      if (res.status === 200) {
        await drainStream(res);
      }
      expect(res.status).toBe(200);
    }

    // 31st request must be rate limited
    const res31 = await runFetch(chatRequest(ip));
    expect(res31.status).toBe(429);

    // Anthropic must have received at most 30 calls
    expect(captured.count).toBeLessThanOrEqual(limit);
  });

  it("different IPs are not affected by each other's rate limit", async () => {
    const captured: CapturedRequest = { count: 0 };
    mockAnthropicStream(captured);

    const ip1 = "10.0.0.1";
    const ip2 = "10.0.0.2";

    // ip2 key cleanup
    const today = new Date().toISOString().slice(0, 10);
    const hour = new Date().getUTCHours().toString().padStart(2, "0");
    await getEnv().STATE.delete(`ratelimit:${ip2}:${today}-${hour}`);

    // First request from ip2 should succeed even if ip1 is exhausted
    const limit = 30;
    for (let i = 0; i < limit; i++) {
      const res = await runFetch(chatRequest(ip1));
      if (res.status === 200) await drainStream(res);
    }

    const res = await runFetch(chatRequest(ip2));
    expect(res.status).toBe(200);
    if (res.status === 200) await drainStream(res);
  });
});
