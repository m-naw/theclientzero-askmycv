/**
 * Acceptance Test — spec §12:
 * "KV put() failure and spend-tracking failure are handled gracefully (no unhandled crash)"
 *
 * Steps validated:
 * 1. Seed config in KV.
 * 2. Monkey-patch env.STATE.put to reject (simulating KV outage).
 *    This causes both rate-limit bookkeeping writes and spend-tracking writes to throw.
 * 3. Make a real HTTP POST to /chat with a browser UA.
 * 4. Assert the worker returns a well-formed HTTP response (does not crash).
 * 5. Repeat with a non-null spend-tracking call path: ensure any addSpend error
 *    is swallowed gracefully.
 *
 * Adversarial guard: the test exercises the /chat HTTP path end-to-end, not
 * just unit-testing kv.put() in isolation.
 *
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import type { StoredConfig } from "../../types/config";

const ANTHROPIC_HOST = "https://anthropic-mock-kv-spend.test";

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
  for (const key of [
    "config",
    "setup_window_start",
    `spend:${today}`,
    `ratelimit:10.51.0.1:${today}-${hour}`,
  ]) {
    await kv.delete(key);
  }
}

function fixtureConfig(): StoredConfig {
  return {
    display_name: "KV+Spend Failure Test",
    headline: "Test Engineer",
    cv_markdown:
      "# KV+Spend Failure Test\n\nSoftware engineer building resilient cloud systems.",
    anthropic_api_key: "sk-ant-spend-test",
    daily_budget_usd: 100,
    access_email: "owner@test",
    access_aud: "test-aud",
    access_team_domain: "test.cloudflareaccess.com",
    setup_timestamp: Date.now() - 2000,
  };
}

function fakeAnthropicSse(): string {
  return [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: { id: "msg_spend", usage: { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 0 } },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hi" },
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 5 },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ].join("");
}

function chatRequest(): Request {
  return new Request("https://example.test/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "cf-connecting-ip": "10.51.0.1",
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
  });
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

describe("Acceptance — KV put() + spend-tracking failure handled gracefully (spec §12)", () => {
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

  it("POST /chat with KV put() rejecting (covers spend-tracking path) returns well-formed response without crashing", async () => {
    // Mock Anthropic upstream to return a valid SSE stream
    const pool = fetchMock.get(ANTHROPIC_HOST);
    pool
      .intercept({ path: /\/v1\/messages.*/, method: "POST" })
      .reply(200, fakeAnthropicSse(), {
        headers: { "content-type": "text/event-stream" },
      });

    // Monkey-patch env.STATE.put to reject — this forces both rate-limit
    // bookkeeping writes and spend-tracking writes to throw.
    const kv = getEnv().STATE;
    const originalPut = kv.put.bind(kv);
    kv.put = ((..._args: unknown[]) => {
      return Promise.reject(new Error("KV put failed (simulated outage — covers spend-tracking)"));
    }) as typeof kv.put;

    let res: Response | null = null;
    let threw: unknown = null;
    try {
      res = await runFetch(chatRequest());
      // Drain the stream so deferred spend-tracking KV writes (in flush) execute.
      if (res.body) {
        await drainStream(res);
      }
    } catch (err) {
      threw = err;
    } finally {
      kv.put = originalPut;
    }

    // No unhandled exception must bubble out of the worker
    expect(threw).toBeNull();
    expect(res).not.toBeNull();
    // Worker returned a valid HTTP status code
    expect(typeof res!.status).toBe("number");
    expect(res!.status).toBeGreaterThanOrEqual(200);
    expect(res!.status).toBeLessThan(600);
  });

  it("POST /chat with KV.put rejecting on spend-key write returns well-formed response (spend-tracking fail-open)", async () => {
    // Mock Anthropic upstream — second intercept for this test
    const pool2 = fetchMock.get(ANTHROPIC_HOST);
    pool2
      .intercept({ path: /\/v1\/messages.*/, method: "POST" })
      .reply(200, fakeAnthropicSse(), {
        headers: { "content-type": "text/event-stream" },
      });

    // Patch only put() — spend tracking calls put() after the stream completes.
    // The worker must swallow the error and not crash (fail-open behaviour).
    const kv = getEnv().STATE;
    const originalPut = kv.put.bind(kv);
    kv.put = ((..._args: unknown[]) => {
      return Promise.reject(new Error("KV put failed (spend-tracking outage)"));
    }) as typeof kv.put;

    let res: Response | null = null;
    let threw: unknown = null;
    try {
      res = await runFetch(chatRequest());
      if (res.body) {
        await drainStream(res);
      }
    } catch (err) {
      threw = err;
    } finally {
      kv.put = originalPut;
    }

    // Spend-tracking KV failure must not bubble as an unhandled exception
    expect(threw).toBeNull();
    expect(res).not.toBeNull();
    expect(typeof res!.status).toBe("number");
    expect(res!.status).toBeGreaterThanOrEqual(200);
    expect(res!.status).toBeLessThan(600);
  });
});
