/**
 * Acceptance Test 12 — spec §12 Test 12:
 * "Anthropic failure modes: 5xx, network abort, secrets never leaked"
 *
 * Steps validated:
 * 1. Anthropic 500 → /chat returns non-2xx with JSON { error }.
 * 2-3. Worker recovers — subsequent request after 500 returns 200.
 * 4. Timed-out Anthropic returns non-2xx within bounded real time (5 s).
 * 5. GET / HTML does not contain the Anthropic API key.
 * 6. GET /setup HTML does not contain the Anthropic API key.
 * 7. console spy — API key never appears in console output.
 *
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import type { StoredConfig } from "../../types/config";

const ANTHROPIC_HOST = "https://anthropic-mock-t12.test";
const API_KEY = "sk-ant-g8-redact-test";

interface TestEnv {
  STATE: KVNamespace;
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_TIMEOUT_MS: string;
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

function fixtureConfig(): StoredConfig {
  return {
    display_name: "G8 Test Owner",
    headline: "Senior Engineer",
    cv_markdown:
      "# G8 Test Owner\n\nExperienced backend engineer specializing in Cloudflare Workers and distributed systems.",
    anthropic_api_key: API_KEY,
    daily_budget_usd: 50,
    access_email: "owner@test.example",
    access_aud: "test-aud-t12",
    access_team_domain: "test.cloudflareaccess.com",
    setup_timestamp: Date.now() - 2000,
  };
}

function fakeAnthropicSse(): string {
  return [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: { id: "msg_t12", usage: { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 0 } },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello from test 12" },
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 5 },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ].join("");
}

function chatRequest(content = "Hello"): Request {
  return new Request("https://example.test/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "cf-connecting-ip": "10.12.0.1",
    },
    body: JSON.stringify({ messages: [{ role: "user", content }] }),
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

describe("Acceptance Test 12 — Anthropic failure modes (spec §12)", () => {
  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try {
      fetchMock.enableNetConnect(/localhost/);
    } catch {
      /* no-op */
    }
    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ANTHROPIC_TIMEOUT_MS = "30000";
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
    await getEnv().STATE.put("config", JSON.stringify(fixtureConfig()));
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("Test 12 step 1: Anthropic 500 returns non-2xx with JSON {error}", async () => {
    const pool = fetchMock.get(ANTHROPIC_HOST);
    pool
      .intercept({ path: /\/v1\/messages.*/, method: "POST" })
      .reply(500, "Internal Server Error", {
        headers: { "content-type": "text/plain" },
      });

    const res = await runFetch(chatRequest());
    expect(res.status).toBeGreaterThanOrEqual(400);

    const body = (await res.json()) as { error?: unknown };
    expect(body).toHaveProperty("error");
    expect(body.error).toBeTruthy();
  });

  it("Test 12 steps 2-3: Worker recovers — subsequent request returns 200", async () => {
    const pool = fetchMock.get(ANTHROPIC_HOST);

    // First request: Anthropic 500 -> expect non-2xx
    pool
      .intercept({ path: /\/v1\/messages.*/, method: "POST" })
      .reply(500, "Internal Server Error", {
        headers: { "content-type": "text/plain" },
      });

    const errRes = await runFetch(chatRequest());
    expect(errRes.status).toBeGreaterThanOrEqual(400);

    // Second request: Anthropic 200 SSE -> expect 200
    pool
      .intercept({ path: /\/v1\/messages.*/, method: "POST" })
      .reply(200, fakeAnthropicSse(), {
        headers: { "content-type": "text/event-stream" },
      });

    const okRes = await runFetch(chatRequest());
    expect(okRes.status).toBe(200);
    await drainStream(okRes);
  });

  it("Timed-out Anthropic returns non-2xx within bounded real time (5 s)", async () => {
    (env as Record<string, string>).ANTHROPIC_TIMEOUT_MS = "500";

    const pool = fetchMock.get(ANTHROPIC_HOST);
    pool
      .intercept({ path: /\/v1\/messages.*/, method: "POST" })
      .replyWithError(new Error("The operation was aborted"));

    const start = Date.now();
    const res = await runFetch(chatRequest());
    const elapsed = Date.now() - start;

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(5000);
  });

  it("§10 secrets: GET / body does not contain Anthropic API key", async () => {
    // Config is already seeded in beforeEach — state B_CONFIGURED
    const req = new Request("https://example.test/", { method: "GET" });
    const res = await runFetch(req);
    const bodyText = await res.text();
    expect(bodyText).not.toContain(API_KEY);
  });

  it("§10 secrets: GET /setup body does not contain Anthropic API key", async () => {
    // Remove config so the worker is in A_UNCONFIGURED state — serves /setup
    await getEnv().STATE.delete("config");

    const req = new Request("https://example.test/setup", { method: "GET" });
    const res = await runFetch(req);
    const bodyText = await res.text();
    expect(bodyText).not.toContain(API_KEY);
  });

  it("§10 secrets: console spy — API key never appears in console output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const pool = fetchMock.get(ANTHROPIC_HOST);
      pool
        .intercept({ path: /\/v1\/messages.*/, method: "POST" })
        .reply(500, "Internal Server Error", {
          headers: { "content-type": "text/plain" },
        });

      await runFetch(chatRequest());

      const allCalls = [
        ...consoleSpy.mock.calls,
        ...consoleErrorSpy.mock.calls,
        ...consoleWarnSpy.mock.calls,
      ];

      for (const args of allCalls) {
        const stringified = args.map((a) => String(a)).join(" ");
        expect(stringified).not.toContain(API_KEY);
      }
    } finally {
      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    }
  });
});
