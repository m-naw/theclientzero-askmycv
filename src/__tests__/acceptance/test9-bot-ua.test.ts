/**
 * Acceptance Test 9 — spec §12 Test 9:
 * "Bot UA rejection: curl, empty UA, python-requests → 403"
 *
 * Fixtures: config present.
 * Anthropic mock set up but should receive 0 calls for bot UAs.
 *
 * Steps validated:
 * 1. Request with UA=curl/7.x → 403; Anthropic receives 0 calls.
 * 2. Request with empty UA → 403; Anthropic receives 0 calls.
 * 3. Request with UA=python-requests/2.x → 403; Anthropic receives 0 calls.
 * 4. Request with a browser UA still works normally (200).
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
  for (const key of [
    "config",
    "setup_window_start",
    `spend:${today}`,
    `ratelimit:10.2.3.4:${today}-${hour}`,
  ]) {
    await kv.delete(key);
  }
}

function fixtureConfig(): StoredConfig {
  return {
    display_name: "Bot Test User",
    headline: "Test Engineer",
    cv_markdown:
      "# Bot Test User\n\nSoftware engineer with 8 years of experience building robust, secure web services.",
    anthropic_api_key: "sk-ant-test",
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
      message: { id: "msg_t9", usage: { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 0 } },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ].join("");
}

/** Global counter — incremented inside the mock reply; shared across all tests in this file. */
let globalAnthropicCallCount = 0;

function setupAnthropicMock(): void {
  const pool = fetchMock.get(ANTHROPIC_HOST);
  pool
    .intercept({ path: /\/v1\/messages.*/, method: "POST" })
    .reply((_opts: { body?: string }) => {
      globalAnthropicCallCount += 1;
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

function chatRequest(userAgent: string | null): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cf-connecting-ip": "10.2.3.4",
  };
  if (userAgent !== null) {
    headers["user-agent"] = userAgent;
  }
  return new Request("https://example.test/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  });
}

describe("Acceptance Test 9 — bot UA rejection (spec §12)", () => {
  beforeEach(async () => {
    globalAnthropicCallCount = 0;
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
    setupAnthropicMock();
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("rejects curl UA with 403; Anthropic receives 0 calls", async () => {
    const countBefore = globalAnthropicCallCount;
    const res = await runFetch(chatRequest("curl/7.68.0"));
    expect(res.status).toBe(403);
    expect(globalAnthropicCallCount).toBe(countBefore);
  });

  it("rejects empty UA with 403; Anthropic receives 0 calls", async () => {
    const countBefore = globalAnthropicCallCount;
    const res = await runFetch(chatRequest(""));
    expect(res.status).toBe(403);
    expect(globalAnthropicCallCount).toBe(countBefore);
  });

  it("rejects missing UA header with 403; Anthropic receives 0 calls", async () => {
    const countBefore = globalAnthropicCallCount;
    const res = await runFetch(chatRequest(null));
    expect(res.status).toBe(403);
    expect(globalAnthropicCallCount).toBe(countBefore);
  });

  it("rejects python-requests UA with 403; Anthropic receives 0 calls", async () => {
    const countBefore = globalAnthropicCallCount;
    const res = await runFetch(chatRequest("python-requests/2.28.0"));
    expect(res.status).toBe(403);
    expect(globalAnthropicCallCount).toBe(countBefore);
  });

  it("allows browser UA (Mozilla/Chrome) with 200", async () => {
    const countBefore = globalAnthropicCallCount;
    const browserUA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    const res = await runFetch(chatRequest(browserUA));
    expect(res.status).toBe(200);

    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
    expect(globalAnthropicCallCount).toBe(countBefore + 1);
  });

  it("rejects wget UA with 403; Anthropic receives 0 calls", async () => {
    const countBefore = globalAnthropicCallCount;
    const res = await runFetch(chatRequest("Wget/1.21.2"));
    expect(res.status).toBe(403);
    expect(globalAnthropicCallCount).toBe(countBefore);
  });
});
